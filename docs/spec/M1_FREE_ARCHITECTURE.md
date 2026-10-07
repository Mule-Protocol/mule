# M-1 : développer le protocole MULE sur devnet

## Rôle et cadre

Tu développes le protocole MULE : un escrow Solana qui ne paie un agent IA que si sa livraison passe des critères fixés à l'avance. Ce message remplace `PROMPT_M-1_etape-1.md`. Si tu as déjà commencé l'étape 1, reprends là où tu en es.

**Trois règles absolues :**
1. **Devnet uniquement.** Aucun déploiement sur mainnet, aucune clé mainnet, aucun fonds réel, rien qui touche au token $MULE.
2. **Tout le travail est visible publiquement sur GitHub.** Dépôt public, PR, commits explicites, CI publique, issues et rapports.
3. **Aucun service payant, aucune inscription à faire par le propriétaire.** Pas de forfait Cloudflare Workers, pas de clé d'API d'IA, pas de fournisseur RPC privé, pas d'abonnement. Seuls les outils gratuits sont autorisés : GitHub Free sur dépôt public (Actions illimitées), RPC publique devnet `https://api.devnet.solana.com`, faucet devnet, outils open source.

Si une tâche semble exiger un service payant ou un compte nouveau, arrête-toi et propose une alternative gratuite.

## Spécifications de référence

- `C:\Users\mootc\Downloads\MULE-prompts-Astra\02_M-1_devnet\SPEC_M-1_devnet_v2.md`
- `C:\Users\mootc\Downloads\MULE-prompts-Astra\02_M-1_devnet\PROMPT_M-1_devnet.md` (v1, à laquelle la v2 renvoie pour les détails des §2.4 et §2.5)

Si tu ne peux pas lire ces fichiers, arrête-toi et demande-les en pièces jointes. N'écris aucune spécification de mémoire. Copie-les sans modification dans `docs/spec/` du dépôt.

**De la spec v2, tu reprends tel quel :**
- le programme d'escrow (§2) : comptes, 12 instructions, événements, machine d'états, exigences de sécurité, tests ;
- le jeton de règlement dUSDC (§3) ;
- la logique du validateur (§5) et de l'agent (§6) ;
- les règles (§10).

**Ce message remplace les parties hébergement et console (§4, §7, §8 et §9) par les choix ci-dessous**, sans service payant.

## Architecture gratuite (remplace §4, §7 et §8 de la spec)

**Dépôt.** `Mule-Protocol/mule`, public, sous licence Apache-2.0, monorepo `pnpm` :

```
programs/mule_escrow/   programme Anchor (Rust)
packages/sdk/           client TypeScript : PDA, instructions, décodage, événements
packages/validator/     validateur déterministe (CLI Node), sans IA
packages/agent/         agent de référence (CLI Node)
packages/runner/        orchestrateur : crée les missions et enchaîne agent, validateur et finalisation
fixtures/               schémas de critères et entrées d'exemple
data/                   critères, livraisons et rapports, adressés par leur sha256
scripts/                mise en place devnet : mint dUSDC, config, financement
docs/                   spec, architecture, machine d'états, runbook, modèle de menaces, check-ins
```

**Stockage (remplace R2).** Les critères, livraisons et rapports sont des fichiers JSON committés dans `data/<sha256>.json`. Leur URI on-chain est leur adresse `raw.githubusercontent.com` sur `main`. Tout fichier relu est re-haché, et rejeté si l'empreinte ne correspond pas.

**Agent (remplace §6, partie IA).**
- Aucun appel à un modèle d'IA payant.
- Il produit la livraison de façon **déterministe**, à partir des fixtures des trois modèles de mission.
- En mode `dishonest`, il corrompt exactement un champ requis : pour une facture, il retire `total_amount`.
- Le README et les rapports le disent clairement : « agent de référence scripté ; le branchement d'un agent IA réel est prévu plus tard ». L'interface de l'agent doit permettre de brancher un vrai modèle sans toucher au reste.

**Validateur.** Déterministe (Ajv, JSON Schema 2020-12, plus les contrôles croisés de la spec), idempotent, sans IA.

**Exécution publique (remplace les Workers).** Un workflow GitHub Actions `devnet-run.yml`, lancé manuellement (`workflow_dispatch`, avec un nombre de missions en paramètre) et par une planification modérée, enchaîne pour chaque mission :

> création → acceptation → livraison → verdict → `finalize`, `refund_expired` ou `refund_stale`

Chaque passage :
- écrit les signatures de transaction dans les logs publics du run ;
- ajoute un rapport `runs/<date>-<run>.md` avec les liens Solana Explorer (`?cluster=devnet`), committé par une PR automatique ou un commit sur une branche dédiée `runs`.

Pour que les missions se règlent vite, utilise une `dispute_window` de 60 secondes pour les missions du runner.

**Clés et SOL devnet.**
- Les clés (validateur, agent, client faucet, autorité du mint dUSDC) sont **uniquement devnet**. Génère-les localement et stocke-les **seulement** comme secrets GitHub Actions du dépôt.
- Si tu n'as pas le droit d'ajouter des secrets, arrête-toi et donne au propriétaire le chemin exact : `Settings › Secrets and variables › Actions › New repository secret`, avec le nom de chaque secret. Ne lui transmets jamais une valeur de clé dans le chat ou un fichier.
- Financement : quelques SOL devnet suffisent, puisque le loyer des comptes est récupéré à la clôture des missions. Utilise le faucet devnet, documente le solde nécessaire, et fais échouer le run proprement si le solde est trop bas, sans boucle d'airdrop.

**Le site `mule-site` n'est pas modifié dans ce jalon.** Sa console reste une simulation. Le branchement de la console sur devnet est un jalon ultérieur.

## Traces visibles sur GitHub

- Crée un **milestone GitHub** « M-1 · Devnet escrow », avec une issue par étape ci-dessous.
- Tout passe par des **PR en brouillon**, liées à leur issue, avec des commits explicites. Le premier commit sur `main` ne contient que `README.md`, `LICENSE`, `.gitignore` et `docs/spec/`.
- CI publique sur chaque PR : compilation, `anchor test`, `cargo clippy -D warnings`, lint, vérification de types, tests du SDK, du validateur et de l'agent. Ajoute un rapport de couverture par instruction.
- Le README affiche le statut de la CI, l'ID du programme devnet, et un lien vers le dernier rapport de run.
- **Build vérifiable** du programme avec l'outil open source `solana-verify`, et le hash documenté.
- Active les outils gratuits des dépôts publics : Dependabot et l'analyse des secrets.

## Étapes et check-ins

À chaque check-in : écris `docs/checkins/CHECKIN-N.md` (ce qui est fait, liens, preuves, écarts avec la spec, questions ouvertes, ce que tu n'as pas pu vérifier), mets à jour l'issue, puis **arrête-toi et attends**. Une review indépendante est faite à chaque check-in, et seul le propriétaire fusionne.

1. **Programme et tests.** Programme complet selon la spec §2, avec tous les tests et la couverture. SDK avec ses tests. `docs/state-machine.md` et une première version de `docs/threat-model.md`.
   → *Check-in 1.*
2. **Déploiement devnet.** Mint dUSDC, `initialize_config`, programme déployé, build vérifiable. Une mission honnête et une malhonnête de bout en bout, par script local.
   → *Check-in 2 : ID du programme, liens Explorer des deux missions, runbook.*
3. **Validateur, agent et stockage.** Les trois modèles de mission (`invoice.v1`, `contract.v1`, `address.v1`), avec les messages d'échec de la console. Idempotence testée : relance après échec en pleine mission, sans double verdict. Balayage `finalize`, `refund_expired` et `refund_stale`.
   → *Check-in 3 : 10 missions par script, toutes correctes (3 modèles × 2 comportements, plus 4).*
4. **Runner public.** Le workflow `devnet-run.yml` tourne sur GitHub Actions avec les secrets, et un premier run de 10 missions est publié dans `runs/`.
   → *Check-in 4 : lien du run, rapport, coût en SOL devnet par mission.*
5. **Les 100 missions.** Runs publics jusqu'à 100 missions réglées ou remboursées, dont au moins 40 malhonnêtes, toutes remboursées.
   → *Rapport final `docs/M1-REPORT.md` : ID du programme, liste des 100 missions avec leur issue et leur lien Explorer, preuve que chaque mission malhonnête a été remboursée, incidents éventuels.*

## Interdits

- Rien sur mainnet. Aucune clé mainnet, aucun fonds réel, rien qui touche à $MULE.
- Aucun service payant, aucun compte à créer par le propriétaire, aucun changement de forfait.
- Aucun secret dans le dépôt, les logs, les rapports ou le chat. Les clés devnet vont seulement dans les secrets GitHub Actions.
- Aucune modification du dépôt `mule-site`, de Cloudflare ou du DNS.
- Ne fusionne jamais toi-même dans `main`, et ne modifie pas les réglages de protection du dépôt.
- Aucune fonctionnalité hors de ce jalon : ni staking, ni bonds, ni marketplace.
- Si une exigence est floue ou contredit la spec, arrête-toi et pose la question.

Commence par l'étape 1, ou reprends-la si elle est déjà en cours.
