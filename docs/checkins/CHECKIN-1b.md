# CHECK-IN 1b — corrections après review

Date : 7 octobre 2026. **Arrêt à ce check-in ; aucune étape 3 engagée. PR toujours en brouillon, sans fusion.**

## Références et commits

La review du check-in 1, communiquée par le propriétaire, concluait « Validé avec réserves » sur de9c24e. Les évolutions ci-dessous ont été explicitement autorisées ensuite ; les spécifications originales restent inchangées comme références historiques.

- [PR #6](https://github.com/Mule-Protocol/mule/pull/6), même branche codex/m1-escrow-sdk ; [issue #1](https://github.com/Mule-Protocol/mule/issues/1).
- [6aee489 — intégrité des outils et push main](https://github.com/Mule-Protocol/mule/commit/6aee489).
- [0d3c1c4 — agent désigné, délai et transfert admin](https://github.com/Mule-Protocol/mule/commit/0d3c1c4).
- [6e63691 — SDK, historique persistant, tests et documentation](https://github.com/Mule-Protocol/mule/commit/6e63691).
- [0c6f3a4 — format Rust et IDL générée avec vérification CI](https://github.com/Mule-Protocol/mule/commit/0c6f3a4).
- Les commits de publication de l'IDL, des preuves et du présent rapport figurent dans l'[historique de la PR](https://github.com/Mule-Protocol/mule/pull/6/commits). Aucun amend, rebase ou force-push.
- [Run CI vert](https://github.com/Mule-Protocol/mule/actions/runs/37675839365), commit 0c6f3a4c65b57e3d3d3da7d99d5cc6098b8a080c.

## Évolutions livrées

1. **Agent désigné.** create_mission ajoute designated_agent: Option<Pubkey> en dernier argument, stocké dans Mission et MissionCreated. Some réserve l'acceptation à ce signataire (NotDesignatedAgent) ; None garde l'acceptation ouverte. Le client ne peut pas se désigner (ClientCannotDesignateSelf).
2. **Litiges bornés.** DISPUTE_TIMEOUT = 1 209 600 secondes, depuis disputed_at. original_verdict conserve le booléen d'origine. finalize sur Disputed refuse avant le délai (DisputeTimeoutNotReached) ; à la borne exacte, n'importe quel signataire applique Passed → agent ou Failed → client, puis ferme les comptes.
3. **Administrateur transférable.** propose_admin exige l'admin actuel et une clé non nulle ; accept_admin exige le signataire pending_admin, remplace l'admin puis efface pending_admin. Événements AdminProposed / AdminAccepted. L'ancien admin conserve ses droits jusqu'à l'acceptation, puis les perd.
4. **Historique SDK.** create_mission exige un MissionIdHistory et réserve atomiquement l'identité programme/client/u64 avant de rendre l'instruction. FileMissionIdHistory fournit la persistance Node, y compris entre processus ; aucune réservation n'est libérée après échec ou clôture. L'adaptateur mémoire sert uniquement aux tests.
5. **CI.** Déclencheurs PR et push main. Anchor 0.32.2 officiel otter-sec/anchor et archive Solana/Agave 2.3.0 téléchargés à des URL versionnées ; SHA-256 épinglés vérifiés avant installation/extraction. Aucun installateur distant exécuté. [Sources et empreintes](../testing/BUILD-TOOLS.md).

L'[IDL générée](../../idl/mule_escrow.json), le SDK, la [machine d'états](../state-machine.md) et le [modèle de menaces](../threat-model.md) décrivent ces 14 instructions. La CI compare l'IDL régénérée au fichier versionné. Les layouts Config/Mission changent ; aucune migration d'instance existante n'a été testée, puisqu'aucun programme n'a été déployé dans ce jalon.

## Validation observée

| Contrôle | Résultat |
| --- | --- |
| SHA-256 des deux outils avant installation | Réussi |
| Compilation SBF et génération de l'IDL | Réussies |
| IDL versionnée = IDL générée | Identiques |
| Formatage Rust et cargo clippy --workspace --all-targets -- -D warnings | Réussis |
| SDK build, types, lint | Réussis |
| Tests SDK | **15/15 réussis**, aucun ignoré |
| Scénarios SBF via anchor test / LiteSVM | **44/44 réussis** |
| Instructions : assertions positives et négatives | **14/14** |

Les assertions instrumentées comptent **257 succès et 141 refus attendus**.

- SHA-256 du SBF testé : `07dce1cb08fe274de5aaa5aebaf4279cd71886ad6a6b6e520a0c7a53b0f997a3`.
- SHA-256 de l'IDL : `78bd0e339f9c60e90f734d8bfdfd821045ec48289d48b9e50ba4089503ce9f32`.
- Artefact du run : **m1-step1-evidence** (couverture, IDL, SBF, lockfile, source Rust).

## Couverture par instruction

| Instruction | Assertions réussies | Refus vérifiés |
| --- | ---: | ---: |
| initialize_config | 53 | 4 |
| update_config | 13 | 6 |
| propose_admin | 4 | 4 |
| accept_admin | 3 | 5 |
| create_mission | 47 | 15 |
| cancel_mission | 4 | 7 |
| accept_mission | 38 | 8 |
| submit_delivery | 32 | 9 |
| record_verdict | 28 | 8 |
| open_dispute | 15 | 10 |
| resolve_dispute | 6 | 11 |
| finalize | 9 | 33 |
| refund_expired | 3 | 8 |
| refund_stale | 2 | 13 |

Comptages issus des assertions exécutées, appels de préparation inclus. Couverture par instruction/scénario, **pas un pourcentage de lignes ou branches Rust**. [Rapport complet](../testing/INSTRUCTION-COVERAGE-1b.md) et [preuves JSON](../testing/INSTRUCTION-COVERAGE-1b.json).

## Tests ajoutés et renforcés

**9 nouveaux scénarios programme : 9/9 réussis** (noms exacts des logs).

| Scénario | Résultat |
| --- | --- |
| designated agent: only the designated signer accepts; field and event agree | Réussi |
| designated agent: None preserves permissionless acceptance | Réussi |
| designated agent: client self-designation rejected atomically | Réussi |
| dispute timeout passed: opening time, exact boundary, recipient, rent and closure | Réussi |
| dispute timeout failed: opening time, exact boundary, recipient, rent and closure | Réussi |
| dispute timeout: overflow rejected without losing original verdict | Réussi |
| resolve_dispute: after timeout first resolution wins and finalization cannot replay | Réussi |
| admin transfer: current admin proposes, pending signer accepts, old rights revoked | Réussi |
| admin transfer: no proposal, replacement, default rejection and replay | Réussi |

**8 nouveaux tests SDK : 8/8 réussis**, en plus des 7 tests antérieurs adaptés.

| Test ajouté | Résultat |
| --- | --- |
| Décodage Mission : agent désigné, date du litige et verdict vrai/faux | Réussi |
| Encodage designated_agent None/Some et position des autres arguments | Réussi |
| Refus de créer sans historique explicite | Réussi |
| Réservation conservée entre instances, alias BN et après construction d'une instruction d'annulation | Réussi |
| Séparation programme/client/identifiant sur tout le domaine u64 | Réussi |
| Deux processus concurrents : une réservation ; redémarrage : refus de réutilisation | Réussi |
| Réservations vides/corrompues : refus conservateur sans suppression | Réussi |
| Erreur de stockage : aucune instruction rendue au demandeur | Réussi |

Les scénarios antérieurs restent exécutés. Les sorties pendant pause incluent désormais les deux règlements après timeout. Les anciens tests d'arbitrage vérifient aussi l'échec d'un finalize après résolution. Les tests d'ABI/décodage existants couvrent les 14 instructions et les nouveaux champs.

## Écarts, choix explicites et limites

- Aucun écart fonctionnel identifié avec les corrections demandées. resolve_dispute reste possible après le délai tant que la mission existe, en plus du cas demandé avant délai. Après le délai, la première transaction valide de résolution/finalisation clôture la mission ; les suivantes échouent.
- L'expiration rend le règlement possible, sans envoyer automatiquement une transaction. Le verdict d'origine reste une autorité de confiance : le timeout ne corrige pas un verdict mensonger.
- La réutilisation des IDs reste permise on-chain, conformément à l'acceptation du propriétaire. Tous les clients/instances doivent partager et conserver le même historique durable. Supprimer/restaurer un ancien historique, employer un autre répertoire ou contourner le SDK annule sa protection. Les réservations consomment aussi les IDs des transactions non envoyées ou échouées. Sur Windows, la synchronisation du répertoire n'est pas disponible comme sur POSIX ; la conservation et la sauvegarde du stockage restent nécessaires.
- Les tests SBF emploient volontairement des historiques mémoire isolés pour que les créations invalides/replays atteignent le programme ; les tests propres au SDK vérifient le garde-fou durable.
- Le runner n'a pas été commencé. Il devra partager cet historique à l'étape 3. Aucun test de ses dix missions n'est revendiqué.
- solana-verify est reporté au premier déploiement, selon la décision du propriétaire. Les empreintes des outils et du SBF ne sont pas une attestation de build reproductible.
- emit! est conservé. L'étude d'emit_cpi! avant l'indexeur est inscrite au modèle de menaces.
- Le déclencheur push main est configuré et vérifié ; aucun push de ces corrections sur main n'a été effectué. Le run cité est celui de la PR.
- Pas d'audit indépendant des corrections, d'intégration Squads, de vérification d'upgrade réelle ni de test réseau public.

## Incident de validation corrigé

Le [premier run](https://github.com/Mule-Protocol/mule/actions/runs/37674934823) passait les 44 scénarios SBF et les 15 tests SDK, mais échouait au contrôle de format Rust sur la macro require! de propose_admin. Clippy n'avait donc pas été exécuté dans ce run. Le format généré par cargo fmt a été repris au commit 0c6f3a4, sans changement de logique ; le run vert cité ci-dessus valide également Clippy. Aucun test retiré, ignoré ou assoupli.

## Périmètre final

Vérifié le 7 octobre 2026 : dépôt **public**, **0 secret Actions**, PR #6 en brouillon. main reste au bootstrap 1a9a83344f2a4cd0c170281588c36ed45065747d. Aucun déploiement, mint devnet, faucet, workflow devnet-run, service payant, opération mainnet/$MULE ou modification de mule-site. Pas de fusion ni de changement des protections. Les tests utilisent des clés jetables ; aucune clé de portefeuille n'est publiée dans les artefacts.

**Travail arrêté au check-in 1b. Seul le propriétaire fusionne ; l'étape 3 attend une nouvelle instruction.**
