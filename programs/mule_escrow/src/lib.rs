use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, TransferChecked};

declare_id!("Fg6PaFpoGXkYsidMpWxTWqkZ7FEfcYkgMQHGho8KDXgL");
pub const STALE_SECONDS: i64 = 7 * 24 * 60 * 60;
pub const MAX_URI_BYTES: usize = 200;
pub const DEFAULT_DISPUTE_WINDOW: i64 = 3600;
pub const DEFAULT_MAX_AMOUNT: u64 = 100_000_000;

#[program]
pub mod mule_escrow {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        admin: Pubkey,
        validator: Pubkey,
    ) -> Result<()> {
        require!(
            admin != Pubkey::default() && validator != Pubkey::default(),
            EscrowError::InvalidAuthority
        );
        ctx.accounts.config.set_inner(Config {
            admin,
            validator,
            mint: ctx.accounts.mint.key(),
            min_dispute_window: DEFAULT_DISPUTE_WINDOW,
            max_amount: DEFAULT_MAX_AMOUNT,
            paused: false,
            bump: ctx.bumps.config,
        });
        emit!(ConfigInitialized {
            config: ctx.accounts.config.key(),
            admin,
            validator,
            mint: ctx.accounts.mint.key()
        });
        Ok(())
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        validator: Pubkey,
        min_dispute_window: i64,
        max_amount: u64,
        paused: bool,
    ) -> Result<()> {
        require!(
            validator != Pubkey::default(),
            EscrowError::InvalidAuthority
        );
        require!(
            min_dispute_window > 0 && max_amount > 0,
            EscrowError::InvalidConfig
        );
        let config = &mut ctx.accounts.config;
        config.validator = validator;
        config.min_dispute_window = min_dispute_window;
        config.max_amount = max_amount;
        config.paused = paused;
        emit!(ConfigUpdated {
            config: config.key(),
            validator,
            min_dispute_window,
            max_amount,
            paused
        });
        Ok(())
    }

    pub fn create_mission(
        ctx: Context<CreateMission>,
        mission_id: u64,
        amount: u64,
        criteria_hash: [u8; 32],
        criteria_uri: String,
        deadline: i64,
        dispute_window: i64,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.paused, EscrowError::Paused);
        require!(
            amount > 0 && amount <= config.max_amount,
            EscrowError::InvalidAmount
        );
        require!(
            deadline > Clock::get()?.unix_timestamp,
            EscrowError::InvalidDeadline
        );
        require!(
            dispute_window >= config.min_dispute_window,
            EscrowError::InvalidWindow
        );
        deadline
            .checked_add(STALE_SECONDS)
            .ok_or(EscrowError::ArithmeticOverflow)?;
        deadline
            .checked_add(dispute_window)
            .ok_or(EscrowError::ArithmeticOverflow)?;
        validate_uri(&criteria_uri)?;
        let mission = &mut ctx.accounts.mission;
        mission.set_inner(Mission {
            client: ctx.accounts.client.key(),
            agent: None,
            mission_id,
            amount,
            criteria_hash,
            criteria_uri,
            delivery_hash: None,
            delivery_uri: None,
            report_hash: None,
            deadline,
            dispute_window,
            verdict_at: None,
            status: Status::Open,
            bump: ctx.bumps.mission,
            vault_bump: ctx.bumps.vault,
        });
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.client_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.client.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        emit!(MissionCreated {
            mission: mission.key(),
            amount,
            status: mission.status,
            client: mission.client,
            mission_id
        });
        Ok(())
    }

    pub fn cancel_mission(ctx: Context<Refund>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.caller.key(),
            ctx.accounts.mission.client,
            EscrowError::Unauthorized
        );
        require!(
            ctx.accounts.mission.status == Status::Open,
            EscrowError::InvalidState
        );
        ctx.accounts.mission.status = Status::Cancelled;
        return_funds(ctx.accounts)?;
        emit!(MissionCancelled {
            mission: ctx.accounts.mission.key(),
            amount: ctx.accounts.mission.amount,
            status: Status::Cancelled
        });
        Ok(())
    }

    pub fn accept_mission(ctx: Context<ActOnMission>) -> Result<()> {
        let mission = &mut ctx.accounts.mission;
        require!(mission.status == Status::Open, EscrowError::InvalidState);
        require!(
            ctx.accounts.actor.key() != mission.client,
            EscrowError::ClientCannotAccept
        );
        // No work can start once the delivery deadline has elapsed.
        require!(
            Clock::get()?.unix_timestamp < mission.deadline,
            EscrowError::DeadlineElapsed
        );
        mission.agent = Some(ctx.accounts.actor.key());
        mission.status = Status::Accepted;
        emit!(MissionAccepted {
            mission: mission.key(),
            amount: mission.amount,
            status: mission.status,
            agent: ctx.accounts.actor.key()
        });
        Ok(())
    }

    pub fn submit_delivery(
        ctx: Context<ActOnMission>,
        delivery_hash: [u8; 32],
        delivery_uri: String,
    ) -> Result<()> {
        let mission = &mut ctx.accounts.mission;
        require!(
            mission.agent == Some(ctx.accounts.actor.key()),
            EscrowError::Unauthorized
        );
        require!(
            mission.status == Status::Accepted,
            EscrowError::InvalidState
        );
        require!(
            Clock::get()?.unix_timestamp < mission.deadline,
            EscrowError::DeadlineElapsed
        );
        validate_uri(&delivery_uri)?;
        mission.delivery_hash = Some(delivery_hash);
        mission.delivery_uri = Some(delivery_uri);
        mission.status = Status::Submitted;
        emit!(DeliverySubmitted {
            mission: mission.key(),
            amount: mission.amount,
            status: mission.status,
            delivery_hash
        });
        Ok(())
    }

    pub fn record_verdict(
        ctx: Context<RecordVerdict>,
        pass: bool,
        report_hash: [u8; 32],
    ) -> Result<()> {
        let mission = &mut ctx.accounts.mission;
        require!(
            mission.status == Status::Submitted,
            EscrowError::InvalidState
        );
        let now = Clock::get()?.unix_timestamp;
        now.checked_add(mission.dispute_window)
            .ok_or(EscrowError::ArithmeticOverflow)?;
        mission.verdict_at = Some(now);
        mission.report_hash = Some(report_hash);
        mission.status = if pass { Status::Passed } else { Status::Failed };
        emit!(VerdictRecorded {
            mission: mission.key(),
            amount: mission.amount,
            status: mission.status,
            pass,
            report_hash,
            verdict_at: now
        });
        Ok(())
    }

    pub fn open_dispute(ctx: Context<ActOnMission>) -> Result<()> {
        let mission = &mut ctx.accounts.mission;
        require!(
            ctx.accounts.actor.key() == mission.client
                || mission.agent == Some(ctx.accounts.actor.key()),
            EscrowError::Unauthorized
        );
        require!(
            matches!(mission.status, Status::Passed | Status::Failed),
            EscrowError::InvalidState
        );
        require!(
            Clock::get()?.unix_timestamp < mission.window_end()?,
            EscrowError::WindowClosed
        );
        mission.status = Status::Disputed;
        emit!(DisputeOpened {
            mission: mission.key(),
            amount: mission.amount,
            status: mission.status
        });
        Ok(())
    }

    pub fn resolve_dispute(ctx: Context<Settle>, pay_agent: bool) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.caller.key(),
            ctx.accounts.config.admin,
            EscrowError::Unauthorized
        );
        require!(
            ctx.accounts.mission.status == Status::Disputed,
            EscrowError::InvalidState
        );
        finish(ctx.accounts, pay_agent)
    }

    pub fn finalize(ctx: Context<Settle>) -> Result<()> {
        require!(
            matches!(ctx.accounts.mission.status, Status::Passed | Status::Failed),
            EscrowError::InvalidState
        );
        require!(
            Clock::get()?.unix_timestamp >= ctx.accounts.mission.window_end()?,
            EscrowError::WindowStillOpen
        );
        let pay_agent = ctx.accounts.mission.status == Status::Passed;
        finish(ctx.accounts, pay_agent)
    }

    pub fn refund_expired(ctx: Context<Refund>) -> Result<()> {
        let mission = &mut ctx.accounts.mission;
        require!(
            matches!(mission.status, Status::Open | Status::Accepted),
            EscrowError::InvalidState
        );
        require!(
            Clock::get()?.unix_timestamp >= mission.deadline,
            EscrowError::NotExpired
        );
        mission.status = Status::Refunded;
        return_funds(ctx.accounts)?;
        emit!(MissionRefunded {
            mission: ctx.accounts.mission.key(),
            amount: ctx.accounts.mission.amount,
            status: Status::Refunded
        });
        Ok(())
    }

    pub fn refund_stale(ctx: Context<Refund>) -> Result<()> {
        let mission = &mut ctx.accounts.mission;
        require!(
            mission.status == Status::Submitted && mission.verdict_at.is_none(),
            EscrowError::InvalidState
        );
        let threshold = mission
            .deadline
            .checked_add(STALE_SECONDS)
            .ok_or(EscrowError::ArithmeticOverflow)?;
        require!(
            Clock::get()?.unix_timestamp >= threshold,
            EscrowError::NotStale
        );
        mission.status = Status::Refunded;
        return_funds(ctx.accounts)?;
        emit!(MissionRefunded {
            mission: ctx.accounts.mission.key(),
            amount: ctx.accounts.mission.amount,
            status: Status::Refunded
        });
        Ok(())
    }
}

fn validate_uri(uri: &str) -> Result<()> {
    require!(
        !uri.is_empty() && uri.len() <= MAX_URI_BYTES,
        EscrowError::InvalidUri
    );
    Ok(())
}

fn move_and_close<'info>(
    mission: &Account<'info, Mission>,
    vault: &Account<'info, TokenAccount>,
    destination: AccountInfo<'info>,
    client: AccountInfo<'info>,
    mint: &Account<'info, Mint>,
    program: &Program<'info, Token>,
) -> Result<()> {
    let id = mission.mission_id.to_le_bytes();
    let bump = [mission.bump];
    let seeds: &[&[u8]] = &[b"mission", mission.client.as_ref(), &id, &bump];
    // Sweep the complete balance: unsolicited SPL transfers cannot prevent closure.
    token::transfer_checked(
        CpiContext::new_with_signer(
            program.to_account_info(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to: destination,
                authority: mission.to_account_info(),
            },
            &[seeds],
        ),
        vault.amount,
        mint.decimals,
    )?;
    token::close_account(CpiContext::new_with_signer(
        program.to_account_info(),
        CloseAccount {
            account: vault.to_account_info(),
            destination: client,
            authority: mission.to_account_info(),
        },
        &[seeds],
    ))?;
    Ok(())
}

fn return_funds(accounts: &Refund<'_>) -> Result<()> {
    move_and_close(
        &accounts.mission,
        &accounts.vault,
        accounts.client_token.to_account_info(),
        accounts.client.to_account_info(),
        &accounts.mint,
        &accounts.token_program,
    )
}

fn finish(accounts: &mut Settle<'_>, pay_agent: bool) -> Result<()> {
    accounts.mission.status = if pay_agent {
        Status::Settled
    } else {
        Status::Refunded
    };
    let destination = if pay_agent {
        accounts.agent_token.to_account_info()
    } else {
        accounts.client_token.to_account_info()
    };
    move_and_close(
        &accounts.mission,
        &accounts.vault,
        destination,
        accounts.client.to_account_info(),
        &accounts.mint,
        &accounts.token_program,
    )?;
    if pay_agent {
        emit!(MissionSettled {
            mission: accounts.mission.key(),
            amount: accounts.mission.amount,
            status: Status::Settled
        });
    } else {
        emit!(MissionRefunded {
            mission: accounts.mission.key(),
            amount: accounts.mission.amount,
            status: Status::Refunded
        });
    }
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub deployer: Signer<'info>,
    // The canonical loader-owned ProgramData proves deployment authority; not first-caller-wins.
    #[account(
        seeds = [crate::ID.as_ref()], bump, seeds::program = bpf_loader_upgradeable::ID,
        constraint = program_data.upgrade_authority_address == Some(deployer.key()) @ EscrowError::Unauthorized
    )]
    pub program_data: Account<'info, ProgramData>,
    #[account(init, payer = deployer, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(constraint = mint.decimals == 6 @ EscrowError::InvalidMint)]
    pub mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin @ EscrowError::Unauthorized)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
#[instruction(mission_id: u64)]
pub struct CreateMission<'info> {
    #[account(mut)]
    pub client: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = mint @ EscrowError::InvalidMint)]
    pub config: Account<'info, Config>,
    #[account(address = config.mint @ EscrowError::InvalidMint)]
    pub mint: Account<'info, Mint>,
    #[account(init, payer = client, space = 8 + Mission::INIT_SPACE,
        seeds = [b"mission", client.key().as_ref(), &mission_id.to_le_bytes()], bump)]
    pub mission: Account<'info, Mission>,
    #[account(init, payer = client, seeds = [b"vault", mission.key().as_ref()], bump,
        token::mint = mint, token::authority = mission)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = client)]
    pub client_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ActOnMission<'info> {
    pub actor: Signer<'info>,
    #[account(mut, seeds = [b"mission", mission.client.as_ref(), &mission.mission_id.to_le_bytes()], bump = mission.bump)]
    pub mission: Account<'info, Mission>,
}

#[derive(Accounts)]
pub struct RecordVerdict<'info> {
    pub validator: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = validator @ EscrowError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"mission", mission.client.as_ref(), &mission.mission_id.to_le_bytes()], bump = mission.bump)]
    pub mission: Account<'info, Mission>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = mint @ EscrowError::InvalidMint)]
    pub config: Account<'info, Config>,
    #[account(address = config.mint @ EscrowError::InvalidMint)]
    pub mint: Account<'info, Mint>,
    #[account(mut, close = client, has_one = client,
        seeds = [b"mission", mission.client.as_ref(), &mission.mission_id.to_le_bytes()], bump = mission.bump)]
    pub mission: Account<'info, Mission>,
    #[account(mut, seeds = [b"vault", mission.key().as_ref()], bump = mission.vault_bump,
        token::mint = mint, token::authority = mission)]
    pub vault: Account<'info, TokenAccount>,
    /// CHECK: exact mission client; only receives reclaimed rent, need not sign.
    #[account(mut, address = mission.client)]
    pub client: UncheckedAccount<'info>,
    #[account(mut, token::mint = mint, token::authority = client)]
    pub client_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = mint @ EscrowError::InvalidMint)]
    pub config: Account<'info, Config>,
    #[account(address = config.mint @ EscrowError::InvalidMint)]
    pub mint: Account<'info, Mint>,
    #[account(mut, close = client, has_one = client,
        seeds = [b"mission", mission.client.as_ref(), &mission.mission_id.to_le_bytes()], bump = mission.bump)]
    pub mission: Account<'info, Mission>,
    #[account(mut, seeds = [b"vault", mission.key().as_ref()], bump = mission.vault_bump,
        token::mint = mint, token::authority = mission)]
    pub vault: Account<'info, TokenAccount>,
    /// CHECK: constrained to the mission client, receives rent only.
    #[account(mut, address = mission.client)]
    pub client: UncheckedAccount<'info>,
    #[account(mut, token::mint = mint, token::authority = client)]
    pub client_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint,
        constraint = Some(agent_token.owner) == mission.agent @ EscrowError::Unauthorized)]
    pub agent_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub validator: Pubkey,
    pub mint: Pubkey,
    pub min_dispute_window: i64,
    pub max_amount: u64,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Mission {
    pub client: Pubkey,
    pub agent: Option<Pubkey>,
    pub mission_id: u64,
    pub amount: u64,
    pub criteria_hash: [u8; 32],
    #[max_len(200)]
    pub criteria_uri: String,
    pub delivery_hash: Option<[u8; 32]>,
    #[max_len(200)]
    pub delivery_uri: Option<String>,
    pub report_hash: Option<[u8; 32]>,
    pub deadline: i64,
    pub dispute_window: i64,
    pub verdict_at: Option<i64>,
    pub status: Status,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Mission {
    fn window_end(&self) -> Result<i64> {
        self.verdict_at
            .ok_or(EscrowError::InvalidState)?
            .checked_add(self.dispute_window)
            .ok_or_else(|| error!(EscrowError::ArithmeticOverflow))
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum Status {
    Open,
    Accepted,
    Submitted,
    Passed,
    Failed,
    Disputed,
    Settled,
    Refunded,
    Cancelled,
}

#[event]
pub struct ConfigInitialized {
    pub config: Pubkey,
    pub admin: Pubkey,
    pub validator: Pubkey,
    pub mint: Pubkey,
}
#[event]
pub struct ConfigUpdated {
    pub config: Pubkey,
    pub validator: Pubkey,
    pub min_dispute_window: i64,
    pub max_amount: u64,
    pub paused: bool,
}
#[event]
pub struct MissionCreated {
    pub mission: Pubkey,
    pub amount: u64,
    pub status: Status,
    pub client: Pubkey,
    pub mission_id: u64,
}
#[event]
pub struct MissionAccepted {
    pub mission: Pubkey,
    pub amount: u64,
    pub status: Status,
    pub agent: Pubkey,
}
#[event]
pub struct DeliverySubmitted {
    pub mission: Pubkey,
    pub amount: u64,
    pub status: Status,
    pub delivery_hash: [u8; 32],
}
#[event]
pub struct VerdictRecorded {
    pub mission: Pubkey,
    pub amount: u64,
    pub status: Status,
    pub pass: bool,
    pub report_hash: [u8; 32],
    pub verdict_at: i64,
}
#[event]
pub struct DisputeOpened {
    pub mission: Pubkey,
    pub amount: u64,
    pub status: Status,
}
#[event]
pub struct MissionSettled {
    pub mission: Pubkey,
    pub amount: u64,
    pub status: Status,
}
#[event]
pub struct MissionRefunded {
    pub mission: Pubkey,
    pub amount: u64,
    pub status: Status,
}
#[event]
pub struct MissionCancelled {
    pub mission: Pubkey,
    pub amount: u64,
    pub status: Status,
}

#[error_code]
pub enum EscrowError {
    #[msg("Unauthorized signer or token recipient")]
    Unauthorized,
    #[msg("Invalid mission state")]
    InvalidState,
    #[msg("New missions are paused")]
    Paused,
    #[msg("Amount must be positive and within the configured cap")]
    InvalidAmount,
    #[msg("Deadline must be in the future")]
    InvalidDeadline,
    #[msg("Dispute window is below the configured minimum")]
    InvalidWindow,
    #[msg("URI must contain 1 to 200 UTF-8 bytes")]
    InvalidUri,
    #[msg("Delivery deadline has elapsed")]
    DeadlineElapsed,
    #[msg("Client cannot accept their own mission")]
    ClientCannotAccept,
    #[msg("Dispute window is still open")]
    WindowStillOpen,
    #[msg("Dispute window is closed")]
    WindowClosed,
    #[msg("Mission is not expired")]
    NotExpired,
    #[msg("Mission is not stale")]
    NotStale,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Invalid settlement mint")]
    InvalidMint,
    #[msg("Invalid configuration")]
    InvalidConfig,
    #[msg("Authority cannot be the default public key")]
    InvalidAuthority,
}
