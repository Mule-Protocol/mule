# CHECK-IN 4 — renforcement M-1.1

Date : 7 octobre 2026. **M-1.1 livré pour review, CI finale verte. Arrêt à ce check-in, PR en brouillon, aucune fusion.**

Ce rapport distingue la CI finale réussie, les preuves conservées du premier échec de fuzzing et les vérifications différées après fusion. Les preuves de couverture, d'audit, de fuzzing et de campagne locale sont rattachées à leurs runs respectifs.

## Références et commits

- [Demande M-1.1](../spec/M1_1_HARDENING.md), [modèle de menaces](../threat-model.md), [machine d'états](../state-machine.md).
- [PR #21 en brouillon](https://github.com/Mule-Protocol/mule/pull/21), branche `codex/m1-1-hardening`, créée depuis main [b4ba5152ed86c3a12567c5b798b11b7c3f624e4b](https://github.com/Mule-Protocol/mule/commit/b4ba5152ed86c3a12567c5b798b11b7c3f624e4b).
- [Milestone M-1.1 · Hardening](https://github.com/Mule-Protocol/mule/milestone/2) ; issues [#16 fuzzing](https://github.com/Mule-Protocol/mule/issues/16), [#17 reprise](https://github.com/Mule-Protocol/mule/issues/17), [#18 chaîne d'approvisionnement](https://github.com/Mule-Protocol/mule/issues/18), [#19 annulation admin](https://github.com/Mule-Protocol/mule/issues/19), [#20 documentation](https://github.com/Mule-Protocol/mule/issues/20).

| Commit | Contenu |
| --- | --- |
| [0c051995ae4869e8eaebe96478e437f7d409fb5a](https://github.com/Mule-Protocol/mule/commit/0c051995ae4869e8eaebe96478e437f7d409fb5a) | Annulation d'une proposition d'admin : programme, événement, erreur, IDL, SDK et tests. |
| [4ef3f5a5924889142aa8926f7067aed21a2b108a](https://github.com/Mule-Protocol/mule/commit/4ef3f5a5924889142aa8926f7067aed21a2b108a) | Conservation exacte des octets de l'IDL produite par Anchor, y compris la fin de fichier. |
| [acb7cc1df741a1a7da7c2dd1028df4ff876a306d](https://github.com/Mule-Protocol/mule/commit/acb7cc1df741a1a7da7c2dd1028df4ff876a306d) | Actions épinglées, audits bloquants, corrections de dépendances et configuration Dependabot. |
| [909bf92c0586abc5b16ef99c1df55fb86734d422](https://github.com/Mule-Protocol/mule/commit/909bf92c0586abc5b16ef99c1df55fb86734d422) | Réconciliation automatique des réservations et clôtures, traitement des transactions incertaines. |
| [874bc2edcc6eec535ce28d2e2dcc3a4a7ab1b0e4](https://github.com/Mule-Protocol/mule/commit/874bc2edcc6eec535ce28d2e2dcc3a4a7ab1b0e4) | Fuzzing du vrai SBF avec modèle indépendant, invariants et preuves persistantes. |
| [1bb68264f56c8aaabf8ad161932d8991b52ce0be](https://github.com/Mule-Protocol/mule/commit/1bb68264f56c8aaabf8ad161932d8991b52ce0be) | Documentation des garanties et limites M-1.1. |
| [945ae76cb3f856847573ee6284a683103962d713](https://github.com/Mule-Protocol/mule/commit/945ae76cb3f856847573ee6284a683103962d713) | Lecture binaire exacte des entiers dans le harnais, le SDK et les observations du runner ; régression conservée. |

La publication de ce rapport et de ses preuves est identifiée dans l'[historique de la PR](https://github.com/Mule-Protocol/mule/pull/21/commits). L'historique n'est pas réécrit.

## État de validation

**Run de référence final vert : [37690611994](https://github.com/Mule-Protocol/mule/actions/runs/37690611994), head `945ae76cb3f856847573ee6284a683103962d713`.**

| Contrôle | Résultat observé à ce stade |
| --- | --- |
| Tests des paquets après correction numérique | **65/65 localement et en CI finale**, dont quatre nouveaux tests numériques, avec trois tests qui piègent `BN.toString()`. |
| Tests purs du harnais fuzz | **10/10** : nombres, codec, comptage, preuves persistantes et frontières d'horloge ; types et lint réussis. |
| Scénarios programme SBF / LiteSVM | **53/53 en CI finale** ; le run initial avait également réussi ces scénarios. |
| Couverture par instruction | **15/15**, 297 succès et 152 refus attendus dans la preuve de la CI finale. |
| Audit npm/Cargo et politique d'exception | **Réussis** ; un finding npm high demeure sous exception conditionnelle, détaillée ci-dessous. |
| Fuzzing initial | **Échec**, puis délai de huit minutes atteint pendant la réduction ; ce run n'est pas vert. |
| Fuzzing après correction | **64/64 séquences**, 1 752 instructions, graine 20261007 ; propriété terminée en 63,749 secondes. |
| Dix missions sur le validateur local | **10/10 dans le run final**, quatre paiements, six remboursements, trois livraisons malhonnêtes remboursées. |
| Reprises a/b/c/d avec processus interrompus | **Réussies dans le run final** ; un seul verdict/règlement, aucun ID consommé réutilisé. |
| Campagne hebdomadaire longue | Configurée, **non exécutée dans cette validation**. |
| Service Dependabot avec la nouvelle configuration | **Non vérifié après fusion** ; la configuration de cette PR n'est pas encore celle de la branche par défaut. |

Les preuves de couverture sont [le tableau brut](../testing/INSTRUCTION-COVERAGE-4.md) et [son JSON](../testing/INSTRUCTION-COVERAGE-4.json). Les résultats sont rattachés au commit de code testé ; les commits suivants publient ces preuves et la documentation.

## Fuzzing : exécution, invariants et limites

Le [harnais documenté](../testing/FUZZING.md) utilise fast-check **4.10.2** et LiteSVM **0.8.0**, avec le vrai SBF et un processus Node neuf par séquence ou évaluation de réduction. Le modèle de transitions ne lit ni le Rust ni l'IDL et prédit le succès ou le refus avant l'envoi.

Configuration courte : graine **20261007**, 64 séquences demandées, au plus 80 commandes générées par séquence. Avec le corpus actuel, les 64 se répartissent en **10 exemples fixes + 1 régression + 53 séquences générées** ; les exemples sont inclus dans `numRuns`. Le workflow hebdomadaire prévoit **512 = 10 + 1 + 501** séquences, au plus 160 commandes, avec une graine aléatoire produite localement et affichée. Ces nombres configurés ne remplacent pas les nombres réellement exécutés.

| Fuzzing final, run 37690611994 | Valeur |
| --- | --- |
| Statut et durée | **Réussi**, `status: complete`, `interrupted: false` ; propriété **63,749 s**, job **78 s**. |
| Graine et SHA-256 SBF/IDL exécutés | Graine **20261007** ; empreintes complètes ci-dessous. |
| Exemples / régressions / séquences générées terminés | **10/10 + 1/1 + 53/53 = 64/64**, aucune séquence échouée. |
| Réductions ou relectures supplémentaires | **0** ; la régression de 66 commandes fait partie des 64 séquences. |
| Instructions réussies / refusées / total | **321 / 1 431 / 1 752** ; chacune des 15 instructions a au moins un succès et un refus. |
| Sauts d'horloge et vérifications d'invariants | **419 sauts**, **2 171 points de contrôle** après instructions/sauts. |
| Artefact de référence final | `m11-fuzz-evidence`, [résumé brut versionné FUZZ-4.json](../testing/FUZZ-4.json). |

SHA-256 du SBF : `7c93e61315ea26fcb7092380ffe02a7efba7c938e9c66e197dbc7b3db4381ab8`. SHA-256 de l'IDL : `0bf513e2d5138be9b4eeb44c3814aa04176ec3329444924213d528ce68275cba`. Le SBF est identique à celui du run ayant révélé l'écart d'observation.

Les sept invariants sont vérifiés après chaque instruction réussie ou refusée et chaque saut d'horloge :

1. Conservation exacte des SPL de tous les acteurs et vaults ; aucun mint/burn après la préparation.
2. Montant exact du vault de chaque mission vivante.
3. Deltas SPL limités au dépôt du client ou au règlement vers le client/agent enregistré ; destinataires étrangers refusés.
4. Clôture unique, comptes fermés et refus des instructions suivantes dans les séquences sans réutilisation d'identifiant.
5. Accord avec le modèle d'états/rôles/temps ; refus sans mutation de Config, mission ou vault.
6. Exclusion du validateur courant comme client/agent désigné à la création et comme agent à l'acceptation.
7. Retour intégral du loyer au client ; les frais SOL sont supportés par un payeur distinct des acteurs.

Les frontières demandées, réellement atteintes, ajustées pour conserver une horloge monotone, ou indisponibles sont comptées séparément. Un souhait de borne « -1 » ajusté à « 0 » n'est pas présenté comme une visite de « -1 ».

Pour la graine finale, les visites effectivement relevées dans `boundariesReached` sont :

| Frontière | Juste avant (-1) | Exacte (0) | Juste après (+1) |
| --- | ---: | ---: | ---: |
| Deadline | 2 | 2 | 0 |
| Fenêtre de litige | 1 | 2 | 0 |
| Stale | 1 | 1 | 0 |
| Délai de litige | 2 | 2 | 0 |

Le générateur comprend les offsets +1, mais cette graine n'en a atteint aucun sur ces quatre frontières. Les 2 171 points de contrôle ne sont ni 2 171 tests indépendants ni un nombre de tests obtenu en multipliant par sept.

### Échec initial et correction

Un [premier run de compilation](https://github.com/Mule-Protocol/mule/actions/runs/37685875051) avait échoué sur un saut de ligne ajouté à l’IDL versionnée. Le commit `4ef3f5a` conserve exactement les octets produits par Anchor ; les comparaisons suivantes passent. Ce décalage de fichier ne constituait pas un défaut du programme.

Le [run initial 37688283162](https://github.com/Mule-Protocol/mule/actions/runs/37688283162), commit `874bc2e`, graine `20261007`, a observé `7816772n` au lieu de `97816772n` dans `BigInt(decoded.amount.toString())`. Le contrôle exact du vault et le contrôle des octets de compte inchangés avaient passé. Un candidat ultérieur présentait aussi `7108864` au lieu de `67108864`. Ces observations **n'établissent ni un défaut du programme Rust/SBF, ni une cause JIT particulière**.

Le délai de huit minutes a interrompu la réduction. Le [résumé initial conservé](../testing/FUZZ-4-initial-summary.json) porte le statut `shrinking`, `passed: null` et 492 147 ms. Il comptabilise 254 évaluations de séquences, **réductions incluses**, 10 163 instructions observées (2 158 succès, 8 005 refus), 3 022 sauts d'horloge et 13 159 points de contrôle. Ces compteurs d'une campagne échouée et interrompue ne constituent pas un résultat validé ni 254 séquences aléatoires indépendantes.

Le [premier échec conservé](../testing/FUZZ-4-initial-failure.json) correspond à l'évaluation 47. Sa [séquence de 66 commandes](../../tests/fuzz/regressions/decimal-bn-observation-37688283162.json) devient une régression permanente. Elle est conservée sans modification et **n'est pas minimale** : `path` reste `null`, `pathPending: true`, faute de réduction terminée. Le défaut du harnais est expliqué dans le [registre des régressions](../../tests/fuzz/regressions/README.md).

Le commit séparé `945ae76` lit les huit octets des champs u64/i64 avec `readBigUInt64LE` / `readBigInt64LE`. Le SDK et le runner utilisent aussi une conversion exacte par octets pour leurs délais et événements. Quatre tests de paquets couvrent cette lecture, dont trois piègent explicitement `BN.toString()`. Les tests purs du harnais contrôlent les montants observés, les bornes u64/i64 et l'accord avec le codec. Le programme Rust n'a pas été modifié pour cette anomalie d'observation. La régression complète passe sur ce même SBF dans la CI finale ; les 53 séquences générées passent également. Ce résultat confirme la correction de l'observation pour les séquences exécutées, sans établir la cause interne de l'ancien rendu décimal.

Reproduction courte, après compilation du SBF/IDL et installation verrouillée des dépendances, sous Linux/Node 24 :

```sh
pnpm fuzz:program --seed 20261007 --runs 64 --steps 80
```

Relecture directe de la régression conservée :

```sh
pnpm fuzz:program --sequence tests/fuzz/regressions/decimal-bn-observation-37688283162.json
```

Les dons externes sont exclus de l'alphabet généré, puisqu'ils augmentent légitimement le solde du vault ; les tests déterministes couvrent déjà leur balayage. L'invariant de clôture ne crée pas une interdiction on-chain de réutiliser une PDA : il suppose l'historique SDK. La rotation du validateur ne retire pas rétroactivement le rôle d'une partie existante. Aucune couverture de lignes/branches, preuve formelle, sécurité de consensus/forks/RPC distribué ou vérité documentaire n'est revendiquée.

## Reprises locales a/b/c/d

Les preuves ci-dessous proviennent du job `local-missions` **réussi** du run final [37690611994](https://github.com/Mule-Protocol/mule/actions/runs/37690611994), commit `945ae76` : [rapport Markdown brut](../../runs/local-2026-10-07-37690611994-1.md), [JSON complet](../../runs/local-2026-10-07-37690611994-1.json). Genesis locale : `NPSXPfhVAp6Pzmm9xUyUs6AN5snwmQim27gAKc4KkzW`. Ces preuves comprennent les signatures publiques, soldes exacts, événements et reprises.

| Injection | Preuve observée sur le réseau local final |
| --- | --- |
| a — `after-report`, mission 1 | Redémarrage après persistance du rapport ; son hash est conservé et un seul verdict apparaît on-chain. |
| b — `after-verdict`, mission 2 | Redémarrage après confirmation, avant confirmation du journal ; reprise de la signature d'origine sans second verdict. |
| c — `after-reserve`, ligne 3 | Premier processus arrêté avec code 42. L'ID **3** est marqué `consumed-never-created`, reste réservé, et sa PDA a **0 signature avant et après**. La mission est créée sous l'ID **11**, puis payée. |
| d — `after-close`, ligne 4 | Premier processus arrêté avec code 42, manifeste encore `pending`. Mission et vault sont fermés. La reprise conserve la signature terminale et **5 signatures avant = 5 après**, sans nouveau règlement. |

PDA consommée du cas c : `Fr6M2MLZmP8TgaenNV7PFLMoEr9aAb7kFr5z7v3dBkoy`. Signature terminale conservée du cas d : `2V6hSHjdy1g3eH59HwNMoeiZHy3rLV2CekNhR6otxAjYsavHkYf5NeBZa6es1HDvwkxoRTkDsiCARtuwtrRhgtGS`. Ce sont des identifiants de ce réseau local jetable, pas des références d'explorateur public.

Les dix missions créées donnent quatre paiements et six remboursements, dont les trois livraisons malhonnêtes. Les **20 comptes** mission/vault sont fermés et chaque mission rend **7 579 440 lamports** au client, soit **75 794 400** au total. Le JSON conserve **46 signatures de missions uniques**, plus **3 signatures de préparation**, soit **49** en les incluant. L'ID consommé sans création ne constitue pas une onzième mission. Pour une clôture reprise, les soldes/rentes viennent des métadonnées avant/après de la transaction terminale d'origine, pas d'une mesure tardive après les autres missions.

Une signature est journalisée avant diffusion ; l'intention de diffusion est persistée avant l'appel RPC. La même signature n'est pas renvoyée à l'aveugle. Une confirmation observée permet de reprendre immédiatement son reçu. Si l'issue reste inconnue, le runner attend que la hauteur finalisée dépasse la dernière hauteur valide du blockhash, puis consulte transaction, statut, PDA et historique conservé. Une absence prouvée autorise une nouvelle signature ; pour `create_mission`, l'ancien ID reste consommé et une nouvelle création reçoit un ID et un délai frais.

La relecture a aussi identifié une création jamais exécutée dont l’échéance originale pouvait être dépassée avant remplacement. Le commit `909bf92` conserve l’ancien ID consommé et passe par une nouvelle création avec un ID et une échéance futurs.

Les tests unitaires couvrent aussi l'expiration sans exécution, l'historique élagué, l'erreur de simulation déterministe et les vues incertaines. **La reprise d'une création expirée est testée unitairement ; elle n'a pas d'injection RPC dédiée dans les dix missions.** Les quatre injections demandées utilisent réellement des processus interrompus sur le même validateur. Un seul pilote doit posséder le journal ; les clés, l'historique et le ledger doivent être conservés durant la reprise. Un historique manquant ou contradictoire bloque le remplacement.

## Annulation admin et couverture des 15 instructions

`cancel_admin_proposal` exige la signature de l'admin courant, efface `pending_admin` et émet `AdminProposalCancelled`. Sans proposition, l'erreur nommée est `NoPendingAdminProposal`. Les tests couvrent l'annulation, le refus du mauvais signataire, le refus sans proposition et l'impossibilité pour l'ancien candidat d'accepter ensuite. L'IDL, le SDK et la machine d'états sont actualisés.

Le tableau suivant reprend [la preuve SBF de la CI finale 37690611994](../testing/INSTRUCTION-COVERAGE-4.json) : **53 scénarios réussis, 297 succès et 152 refus attendus**. Les appels de préparation sont comptés. Chaque succès enregistré vérifie également son événement.

| Instruction | Succès | Refus attendus |
| --- | ---: | ---: |
| initialize_config | 62 | 4 |
| update_config | 17 | 6 |
| propose_admin | 6 | 4 |
| accept_admin | 3 | 6 |
| cancel_admin_proposal | 2 | 3 |
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
| **Total** | **297** | **152** |

Il s'agit de couverture d'instructions/scénarios, distincte des compteurs de fuzzing et de la couverture Rust de lignes/branches.

## Chaîne d'approvisionnement

Chaque référence tierce des workflows utilise le SHA complet, accompagné du tag en commentaire. Les tags ont été résolus sur le dépôt officiel le 7 octobre 2026 ; [provenance et politique](../testing/SUPPLY-CHAIN.md).

| Action | Tag vérifié | Commit exécuté |
| --- | --- | --- |
| actions/checkout | [v4.4.0](https://github.com/actions/checkout/tree/v4.4.0) | `11d5960a326750d5838078e36cf38b85af677262` |
| actions/setup-node | [v4.4.0](https://github.com/actions/setup-node/tree/v4.4.0) | `49933ea5288caeca8642d1e84afbd3f7d6820020` |
| actions/cache/restore et save | [v4.3.0](https://github.com/actions/cache/tree/v4.3.0) | `0057852bfaa89a56745cba8c7296529d2fc39830` |
| actions/upload-artifact | [v4.6.2](https://github.com/actions/upload-artifact/tree/v4.6.2) | `ea165f8d65b6e75b540449e92b4886f43607fa02` |
| actions/download-artifact | [v4.3.0](https://github.com/actions/download-artifact/tree/v4.3.0) | `d3f86a106a0bac45b974a628896c90dbdf5c8093` |

Le workflow hebdomadaire appelle le workflow réutilisable du même commit du dépôt. Il est configuré le lundi à 03:23 UTC, en `contents: read`, sans secret ni push, sur runner Linux public standard. Son activation nécessite sa présence sur la branche par défaut ; la campagne longue n'a pas été exécutée ici. Les artefacts de fuzz conservent graine, compteurs, candidats échoués et réduction ; un candidat provisoire n'est pas étiqueté comme réduction terminée.

Les vérifications SHA-256 Anchor **0.32.2** et Agave **2.3.0** sont maintenues. cargo-audit **0.22.2** vient de la [publication officielle RustSec](https://github.com/rustsec/rustsec/releases/tag/cargo-audit/v0.22.2) ; son archive Linux est vérifiée avant extraction/exécution avec `ab28a1bdb54db4d5d8ad5981cf1f959410370b3d28250dbd35f6a44248620e39`. Aucun installeur distant n'est transmis directement à un shell.

### Audits observés

Preuves brutes : [résumé/politique](../testing/AUDIT-4/summary.json), [pnpm](../testing/AUDIT-4/pnpm.json), [Cargo](../testing/AUDIT-4/cargo.json). Le résumé est daté du **7 octobre 2026 à 21:36:46 UTC**.

| Contrôle | Résultat |
| --- | --- |
| `pnpm audit --prod` brut | **0 critique, 1 élevée, 0 modérée, 0 faible**. |
| RustSec | **0 vulnérabilité**, base `b8a1a33e246a0a9a3b5f377248c41a503defec74`. |
| Avertissement RustSec conservé | `bincode@1.3.3`, [RUSTSEC-2025-0141](https://rustsec.org/advisories/RUSTSEC-2025-0141.html), non maintenu. |
| Politique bloquante | **Réussie avec l'unique exception ci-dessous**, pas « zéro finding ». |

Les vulnérabilités npm high/critical/inconnues et toutes les vulnérabilités RustSec bloquent. Une sortie illisible, une erreur du scanner, une exception expirée ou une mitigation non vérifiée bloque également. Quatre tests de la politique couvrent ces refus. L'option Cargo `--no-yanked` exclut le contrôle distinct des versions retirées ; elle n'ignore aucune vulnérabilité RustSec.

L'[exception documentée](../testing/audit-exceptions.json) concerne exactement `bigint-buffer@1.1.5`, [GHSA-3gc7-fjrx-p6mg](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg), avec réexamen le **6 novembre 2026**. Elle requiert : scripts de compilation désactivés, absence de tout binding natif résoluble, version et SHA-256 exacts du point d'entrée JavaScript, puis tests du fallback aux longueurs 0, 1, 7, 8, 31, 32, 33 et 128. Le résumé atteste `nativeBindingAbsent: true` et la mitigation réussie. La dépendance n'est pas déclarée corrigée ; le convertisseur natif vulnérable est absent du runtime vérifié. La cause interne de l'anomalie de rendu BN du fuzzing n'est pas attribuée à cette alerte.

### Dependabot : cause et état

Deux causes réelles ont été relevées dans les logs :

- Le [run 37679332632](https://github.com/Mule-Protocol/mule/actions/runs/37679332632) rencontrait `ERR_PNPM_NO_MATCHING_VERSION` : le lock sélectionnait `acorn@8.19.0`, publié le 5 octobre, à l'intérieur du délai de trois jours imposé. L'override `acorn@8.18.0`, publié le 28 juillet, conserve cette protection au lieu de la désactiver.
- Les runs sécurité [stream-json](https://github.com/Mule-Protocol/mule/actions/runs/37684914031), [uuid](https://github.com/Mule-Protocol/mule/actions/runs/37684912889) et [toml](https://github.com/Mule-Protocol/mule/actions/runs/37684903778) renvoyaient `security_update_not_possible` : les contraintes parentes retenaient des versions majeures vulnérables.

Les corrections du graphe utilisent `jayson@5.0.0` sous web3.js 1.98.4, supprimant les anciens uuid/stream-json, `toml@4.2.0` sous Anchor TS 0.32.1, et Ajv 8.20.0. La configuration couvre npm, Cargo et GitHub Actions, avec groupes minor/patch, dépendances transitives npm autorisées et délai de trois jours maintenu.

**Limite de validation :** les installations verrouillées et audits vérifient le graphe corrigé ; ils ne prouvent pas que le service géré Dependabot a déjà exécuté cette nouvelle configuration. Ce service lit la branche par défaut. Sa confirmation complète reste à observer après une éventuelle fusion par le propriétaire. Aucune PR Dependabot n'est fusionnée automatiquement.

## Écarts, limites et arrêt

- Le premier fuzzing a échoué puis dépassé le délai pendant la réduction. La séquence conservée est provisoire et non minimale ; son chemin final fast-check n'existe pas. Le correctif est identifié comme correction d'observation/lecture d'entiers, sans affirmation de cause JIT ni défaut Rust établi.
- L'exception npm high est visible, conditionnelle et datée. Elle ne vaut ni correction générale de bigint-buffer ni résultat brut sans vulnérabilité.
- La campagne hebdomadaire longue et le service Dependabot après fusion ne sont pas vérifiés. La reprise spécifique d'une création expirée est couverte par tests unitaires, pas par une cinquième injection réseau.
- Agave 2.3.0 démarre un service faucet interne sans interrupteur CLI. Le cas local gratuit précédemment accepté conserve balance et plafonds à zéro, sans appel/airdrop, compte externe, wallet réel ni API payante ; le financement vient du genesis. [Sources et portée exacte](../runbook-local.md). Le processus interne existe malgré ces limites.
- Les délais de sept jours et quatorze jours utilisent l'horloge simulée LiteSVM ; le test RPC n'attend pas ces durées réelles. `solana-verify`, indexeur/`emit_cpi!`, consensus et audit de sécurité indépendant restent hors de cette validation.
- Dépôt public, branche de travail et PR en brouillon ; main demeure à la base indiquée lors de la préparation. Aucun secret GitHub, déploiement, réseau public, service payant, API d'IA, changement de protection, fusion, force-push, modification de `$MULE` ou de `mule-site`. Les anciens check-ins et rapports sont conservés.

**Arrêt à ce check-in. Aucune fusion par l'agent.**
