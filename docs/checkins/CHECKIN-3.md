# CHECK-IN 3 — validateur, agent et runner locaux

Date : 7 octobre 2026. **Étape 3 livrée pour review. Arrêt à ce check-in, PR en brouillon, aucune fusion.**

## Références et commits

- [Périmètre autorisé](../spec/M1_STAGE3_LOCAL_UPDATE.md), [mise à jour locale](../spec/M1_LOCAL_ONLY_UPDATE.md), [modèles et contrôles §5–6](../spec/SPEC_M-1_devnet_v2.md).
- [PR #13](https://github.com/Mule-Protocol/mule/pull/13), branche codex/m1-local-missions créée depuis main [6a47c49](https://github.com/Mule-Protocol/mule/commit/6a47c49), liée à l'[issue #3](https://github.com/Mule-Protocol/mule/issues/3) du [milestone M-1](https://github.com/Mule-Protocol/mule/milestone/1).
- [72745ed](https://github.com/Mule-Protocol/mule/commit/72745ed) : correctif programme **séparé et en premier**, exclusions du validateur, IDL/SDK/docs/tests.
- [3600e6f](https://github.com/Mule-Protocol/mule/commit/3600e6f) : validateur déterministe, agent de référence scripté, fixtures.
- [a4a8a99](https://github.com/Mule-Protocol/mule/commit/a4a8a99) : runner, journal transactionnel, dix scénarios, sweep et tests.
- [adf4d56](https://github.com/Mule-Protocol/mule/commit/adf4d56) : job local-missions, lanceur et documentation.
- [3a9912c](https://github.com/Mule-Protocol/mule/commit/3a9912c) : rapport de référence, ses 17 contenus, couverture et limites de reprise.
- Le commit du présent check-in figure dans l'[historique de la PR](https://github.com/Mule-Protocol/mule/pull/13/commits). Aucun amend, rebase ou force-push.

**Run de référence vert : [37682350744](https://github.com/Mule-Protocol/mule/actions/runs/37682350744), commit adf4d568957f0ffd54074b05c941f6cffcfebd52.** Les jobs verify et local-missions sont réussis. Le correctif initial avait aussi passé sa [CI séparée](https://github.com/Mule-Protocol/mule/actions/runs/37680740328).

Artefacts : m1-step1-evidence et m1-local-missions-evidence. Le [rapport Markdown brut](../../runs/local-2026-10-07-37682350744-1.md) et son [JSON complet](../../runs/local-2026-10-07-37682350744-1.json) proviennent de ce run, sans retouche. Le JSON conserve les soldes exacts autour de chaque création et règlement, les clés **publiques**, les événements et toutes les signatures.

## Résultats observés

| Contrôle | Résultat |
| --- | --- |
| SHA-256 Anchor/Agave, compilation SBF, IDL régénérée identique, format Rust, clippy | Réussis |
| Compilation des quatre paquets, types, lint | Réussis |
| Tests paquets | **54/54** : SDK 16, validateur/stockage 20, agent 9, runner 9 |
| Scénarios programme SBF / LiteSVM | **51/51** |
| Couverture positive et négative | **14/14 instructions**, 291 succès et 148 refus attendus |
| Campagne sur solana-test-validator | **10/10**, 4 paiements et 6 remboursements |
| Livraisons malhonnêtes | **3/3 remboursées**, messages exacts |
| Fermeture mission/vault et retour intégral du loyer | **10/10** |
| Reprises après les deux pannes demandées | Réussies, un verdict chacune, même hash, aucune transaction supplémentaire |
| Contenus de référence | **17/17 SHA-256 vérifiés**, URI de **132 octets** |

SHA-256 du SBF exécuté : 82999be4b776fb5c7cc5fa02351ee08cbcc4ce8a67baea5322d04c740e0610f1.
SHA-256 de l'IDL : 0d5cb41dbc82b5ed4f7faa3fd5181baa255d6dc84fcc00fc63d5214bfd4863a8.

## Tableau des dix missions

Toutes portent sur **5 dUSDC locaux** (5 000 000 unités, six décimales, aucune valeur). Les chiffres C/A ci-dessous sont les soldes client/agent en dUSDC **juste avant → juste après le règlement**. Les fenêtres se chevauchent ; le JSON montre séparément les soldes avant/après création. L'admin paie les frais, donc le loyer retourné au client est vérifiable sans soustraction de frais.

| # | Modèle / mode | Message du validateur | Issue / instruction | C avant → après | A avant → après |
| --- | --- | --- | --- | ---: | ---: |
| 1 | invoice.v1 / honest | 6/6 FIELDS VALID | agent payé / finalize | 55 → 55 | 0 → 5 |
| 2 | invoice.v1 / dishonest | 5/6 · MISSING: total_amount | client remboursé / finalize | 55 → 60 | 5 → 5 |
| 3 | contract.v1 / honest | 5/5 FIELDS VALID | agent payé / finalize | 60 → 60 | 5 → 10 |
| 4 | contract.v1 / dishonest | 4/5 · MISSING: governing_law | client remboursé / finalize | 60 → 65 | 10 → 10 |
| 5 | address.v1 / honest | 12/12 ROWS VALID | agent payé / finalize | 65 → 65 | 10 → 15 |
| 6 | address.v1 / dishonest | 11/12 · INVALID POSTCODE, ROW 7 | client remboursé / finalize | 65 → 70 | 15 → 15 |
| 7 | invoice.v1 / honest, agent désigné | 6/6 FIELDS VALID | agent désigné payé / finalize | 70 → 70 | 15 → 20 |
| 8 | invoice.v1 / honest, litige client sur Passed | 6/6 FIELDS VALID | résolution admin : client remboursé / resolve_dispute | 60 → 65 | 0 → 0 |
| 9 | invoice.v1 / jamais acceptée | Not accepted; expiry refund | client remboursé / refund_expired | 70 → 75 | 20 → 20 |
| 10 | invoice.v1 / acceptée, jamais livrée | Accepted, no delivery; expiry refund | client remboursé / refund_expired | 75 → 80 | 20 → 20 |

Pour **chaque ligne**, les comptes Mission et vault ont disparu, le statut terminal a été vérifié dans l'événement de la transaction réussie, et **7 579 440 lamports** de loyer sont revenus au client. Le runner vérifie aussi l'absence de transaction en échec ou supplémentaire dans l'historique de chaque mission. Le solde final est 80 dUSDC client et 20 dUSDC agent, à partir de 100 et 0.

Client public : 9FmcyRcF4p49uukJpiZAihoEn66GVCd2W9qriC6WpmZf. Agent public : 3PjePcwCwB6PvG5xFUbvZQATypeERDvFX4uXt3yZcfdq. Pour la mission 7, designatedAgent et agent relus on-chain correspondent à ce destinataire.

### Preuves des remboursements malhonnêtes

Chaque signature ci-dessous est une transaction locale confirmée, dont l'événement terminal est MissionRefunded. Le client reçoit exactement 5 000 000 unités et l'agent zéro ; les deux comptes ferment et le loyer revient au client. Les [données complètes](../../runs/local-2026-10-07-37682350744-1.json) permettent de retrouver mission, rapports, soldes et signatures intermédiaires.

| Mission | Delta client / agent (unités) | Signature finalize |
| --- | --- | --- |
| 2 — facture | +5 000 000 / 0 | 511GwFzfh7t5omLvi9Wh6e6kdcrTnB8N67WdtAK6k9aGX3NHtrBjqzbfcHu9FooyRBwxJUsxYc4sPKtBowoSQ8Gy |
| 4 — contrat | +5 000 000 / 0 | 2WV8ZgoMLSVkYm9KqmgvMqwiAUkCrAK2d6gQV1g8T1zEtHDPCEnZH5u1VfC7KachxZxprEqtoHbxJhuNrPK9padd |
| 6 — adresses | +5 000 000 / 0 | HepmhEaaHbZVQnzctwZj8vPSctDEGrnPhp7hgN4ues3cQERZ7zQYEi7ABDBfbcAkcMgCnNDvVG84vDWgW7pNQY9 |

## Idempotence effectivement exécutée

MULE_TEST_MODE=1 autorise les injections MULE_TEST_FAULT=after-report et after-verdict. Deux processus validate sortent au point demandé avec le code 42, puis **de nouveaux processus** reprennent sur le même ledger et le même journal. Le validateur relit la mission on-chain, re-hache critères et livraison, et recalcule le rapport.

| Panne | Mission | Verdicts avant → après reprise | Journal transaction au crash → après reprise | Transactions avant règlement |
| --- | --- | --- | --- | --- |
| (a) rapport écrit, verdict pas encore envoyé | 1 | 0 → 1 | absent → confirmed | 4 transactions, 4 signatures uniques |
| (b) verdict confirmé, état local pas encore confirmé | 2 | 1 → 1 | signed → confirmed | 4 transactions, 4 signatures uniques |

Les quatre transactions sont create, accept, submit et **un seul** record_verdict. Aucune transaction rejetée en doublon. Les hashes avant/après reprise sont identiques :

- Mission 1 : **119599db54ee8c4e329c9408fa62d813e1459e32440aee2d0a3bb33d1194bfaa**.
- Mission 2 : **97ecdc5ee41b369a114349f61e0252137f5a362109a913d7a41e66b51f4f8b09**.

La panne (b) survient avant l'écriture du statut confirmed dans le journal transactionnel lui-même. La reprise réconcilie sa signature avec la chaîne sans reconstruire ni renvoyer de verdict. Les deux missions ont ensuite été réglées et fermées ; aucune n'est restée bloquée.

## Réseau local et horloge simulée

**Réseau réel isolé dans le job :** Agave 2.3.0 vérifié, programme SBF chargé en genesis comme upgradeable, autorité d'upgrade éphémère, mint local six décimales, initialize_config puis update_config à 60 secondes. Six rôles et la clé du mint sont générés dans le job. Le financement SOL est inscrit au genesis, sans airdrop. Les dix missions, les deux redémarrages, les verdicts, le litige admin, les paiements, les expirations et leurs sweeps utilisent réellement le RPC local et son Clock.

**LiteSVM :** les 51 scénarios exécutent le vrai SBF avec une horloge avancée. Trois scénarios supplémentaires appellent la même fonction sweep pour refund_stale à sept jours et finalize Disputed à quatorze jours, avec verdict d'origine Passed puis Failed. Ils vérifient l'absence d'action une seconde avant, l'action à la borne exacte, destinataire, loyer, fermeture et second sweep sans action. Aucun écoulement réel de sept ou quatorze jours sur le RPC n'est revendiqué.

Sept nouveaux scénarios programme : quatre couvrent les exclusions du validateur et sa rotation ; trois couvrent ces sweeps. Le test SDK ajouté vérifie le Config canonique en lecture seule à l'acceptation. Les 38 tests des nouveaux paquets couvrent schémas/contrôles décimaux, messages exacts, mutation d'un seul champ, stockage altéré, reprise/journal et sélection des sweeps. Voir [tests source](../../tests/escrow.test.ts) et [couverture détaillée](../testing/INSTRUCTION-COVERAGE-3.md).

## Couverture par instruction

| Instruction | Assertions réussies | Refus vérifiés |
| --- | ---: | ---: |
| initialize_config | 60 | 4 |
| update_config | 17 | 6 |
| propose_admin | 4 | 4 |
| accept_admin | 3 | 5 |
| create_mission | 54 | 19 |
| cancel_mission | 5 | 7 |
| accept_mission | 43 | 11 |
| submit_delivery | 35 | 9 |
| record_verdict | 30 | 8 |
| open_dispute | 17 | 10 |
| resolve_dispute | 6 | 11 |
| finalize | 11 | 33 |
| refund_expired | 3 | 8 |
| refund_stale | 3 | 13 |

Source : [rapport CI versionné](../testing/INSTRUCTION-COVERAGE-3.md), [assertions JSON](../testing/INSTRUCTION-COVERAGE-3.json). Appels de préparation inclus. Couverture instruction/scénario, **pas couverture des lignes ou branches Rust**.

## Écarts, choix et limites

1. **Faucet interne Agave.** Le binaire imposé lance obligatoirement un service interne, sans option de désactivation. Après clarification, le propriétaire a choisi le cas local sans branchement ni paiement. Il est neutralisé : solde genesis nul, plafonds par requête/période nuls, port automatique ; aucun appel n'est effectué. Ce service existe malgré ces limites. Aucune connexion à un compte, wallet, fournisseur ou API externe n'a été ajoutée. [Sources et réglages exacts](../runbook-local.md). Les runners standards du dépôt public sont gratuits selon la [documentation GitHub](https://docs.github.com/en/actions/concepts/billing-and-usage).
2. **Choix de fixtures explicités.** La spec impose cinq champs contractuels mais ne nomme que governing_law : les quatre autres sont title, parties, effective_date et termination. address.v1 est limité au format français à cinq chiffres, douze lignes. Les montants sont des chaînes décimales à deux chiffres, comparées en centimes entiers. [Détails](../../fixtures/README.md).
3. **RPC configurable.** Le runner accepte une URL HTTP(S) paramétrée. Le lanceur de tests autorisé impose le loopback pour créer son réseau éphémère. Le changement d'URL vers un autre réseau n'a pas été exécuté.
4. **URI main.** Les URI demandées font 132 octets. Le résolveur reste local et re-hache chaque lecture. Les 17 contenus sont publiés dans cette branche ; leur présence HTTP sur main dépend d'une fusion par le propriétaire, non effectuée.
5. **Reprise bornée.** Un seul pilote doit utiliser un journal. La preuve porte sur les deux points injectés. Une panne entre réservation SDK de l'identifiant et écriture du journal signé, ou entre clôture on-chain et mise à jour du manifeste, peut nécessiter une réconciliation manuelle. Les transactions expirées à issue incertaine ne sont pas reconstruites automatiquement. Relancer le lanceur externe crée volontairement un nouveau ledger.
6. **Limites de sécurité.** Aucun audit indépendant, fuzzing, vérification formelle, test distribué, upgrade live ou Squads CPI. solana-verify reste reporté au premier déploiement. Le validateur prouve les règles encodées, pas la vérité d'un document. Les risques de rotation vers une partie déjà engagée restent décrits dans le [modèle de menaces](../threat-model.md).

## Traces et arrêt

Le [runbook](../runbook-local.md) donne la commande unique ; README et architecture sont actualisés. Le workflow conserve PR + push main, contents:read, aucun secret et aucun push CI. Les artefacts publics excluent clés privées, ledger, logs et journal. Les clés temporaires sont détruites en fin de job ; aucun fonds réel n'est utilisé.

Les issues [2](https://github.com/Mule-Protocol/mule/issues/2), [4](https://github.com/Mule-Protocol/mule/issues/4) et [5](https://github.com/Mule-Protocol/mule/issues/5) restent ouvertes avec le commentaire demandé : « Reportée : voir docs/spec/M1_LOCAL_ONLY_UPDATE.md ».

Aucun déploiement public, devnet, mainnet, API d'IA, service payant, secret GitHub, modification de $MULE ou mule-site, fusion ou changement de protection de branche. **Arrêt à CHECKIN-3.**
