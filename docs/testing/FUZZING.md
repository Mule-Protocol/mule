# Fuzzing local du programme MULE

Le harness exécute le **vrai binaire SBF** avec LiteSVM 0.8.0. fast-check 4.10.2 génère et réduit les séquences. Chaque séquence, y compris chaque tentative de réduction, utilise un processus Node neuf pour isoler le moteur natif. Aucun RPC, cluster public, service externe ou clé réelle n'est utilisé.

## Reproduction en une commande

Depuis la racine, avec les dépendances installées et les fichiers `target/deploy/mule_escrow.so` / `target/idl/mule_escrow.json` compilés et assortis :

```sh
pnpm fuzz:program --seed 20261007 --runs 64 --steps 80
```

Environnement d'exécution : Linux, Node 24, même IDL/SBF que la CI. Le rapport conserve les SHA-256 des deux fichiers. Le build existant du runbook local peut produire ces fichiers ; le fuzzing ne déploie rien. Windows/Node 22 n'est pas un environnement natif validé et le pilote le refuse explicitement.

Après une réduction terminée, copier la commande `reproduce` de `coverage/fuzz/failure.json` : graine, tailles et `--path` retourné par fast-check. Pendant la réduction, ce chemin n'est pas encore exposé par l'API publique : il est explicitement `null`, avec `pathPending: true` et le statut `shrinking`. La graine et chaque candidat échoué sont déjà sauvegardés. Même si le job s'arrête, le dernier candidat conservé se rejoue directement :

```sh
pnpm fuzz:program --sequence coverage/fuzz/minimal-sequence.json
```

Il faut conserver la même version du générateur, le même corpus et le même SBF pour rejouer une graine ou un chemin à l'identique.

## Campagnes

- PR et push main : 64 séquences demandées, au maximum 80 commandes aléatoires par séquence, graine fixe affichée `20261007`. La durée réelle et les nombres exécutés figurent dans le rapport ; la cible CI est moins de dix minutes.
- Hebdomadaire : 512 séquences demandées, au maximum 160 commandes, graine aléatoire obtenue par `crypto.randomBytes` puis affichée. Aucune source aléatoire réseau.
- Variables équivalentes : `MULE_FUZZ_SEED`, `MULE_FUZZ_RUNS`, `MULE_FUZZ_STEPS`, `MULE_FUZZ_PATH`. Omettre la graine demande une nouvelle graine, jamais une graine cachée.
- Dix exemples de frontières et d'administration précèdent les séquences aléatoires. Avec fast-check 4.10.2, ils sont **inclus** dans `numRuns`. Avec le corpus actuel, 64 = 10 exemples fixes + 1 régression conservée + 53 séquences aléatoires ; 512 = 10 + 1 + 501. Sans régression, ces répartitions seraient 10 + 54 et 10 + 502. Cette sémantique a été vérifiée avec un compteur indépendant. Les régressions persistantes sont lues dans `tests/fuzz/regressions/*.json` et augmentent la part déterministe. Les exemples ne constituent pas à eux seuls le fuzzing.
- Le nombre de commandes peut être réduit jusqu'à zéro par fast-check. Une commande `progress` choisit une seule instruction selon l'état du modèle indépendant pour atteindre aussi des chemins profonds ; elle ne court-circuite aucune vérification SBF.
- Le worker est borné à 30 secondes. Un dépassement, une panne native ou une assertion est un échec, sans relance silencieuse.

## Modèle indépendant et sept invariants

`tests/fuzz/model.ts` décrit les transitions publiées dans [state-machine.md](../state-machine.md), avec des valeurs ordinaires et sans décodage d'IDL, d'appel au SDK ou de lecture du Rust. Le worker prédit succès/refus **avant** d'envoyer l'instruction, puis compare les comptes réels au modèle. Les champs BN du décodeur sont lus par leurs huit octets avec `readBigUInt64LE` / `readBigInt64LE`, jamais via une chaîne décimale. Les [tests numériques](../../tests/fuzz/numeric.test.ts) vérifient aussi les limites de signe et de largeur contre les octets du codec. Les signataires, destinataires de token, montants, échéances, fenêtres, pause, rotation et transfert d'admin varient.

Après chaque instruction MULE, réussie **ou refusée**, et chaque saut d'horloge :

1. Somme exacte des SPL de tous les six acteurs, clients/agents compris, et des vaults = somme initiale. Les frais SOL sont isolés sur un payeur qui n'est aucun des acteurs.
2. Chaque mission vivante possède un vault dont le montant est exactement celui convenu.
3. Tous les deltas SPL des six acteurs sont comparés au seul transfert autorisé : dépôt du client ou paiement au client/agent enregistré. Des comptes de destination d'autres acteurs sont aussi proposés et doivent être rejetés.
4. Les comptes terminés restent fermés ; les instructions sur ces missions doivent échouer. Les identifiants de création sont toujours nouveaux et réservés par une même `MissionIdHistory`.
5. Toute réussite et tout refus doivent correspondre au modèle de transitions, y compris rôles et fenêtres. Un refus ne doit changer aucun compte de mission/vault/Config ; les champs immuables et les horodatages sont comparés.
6. Le validateur courant ne peut être client ou agent désigné **à la création**, ni devenir agent **à l'acceptation**. La rotation et la révocation des droits d'admin font partie des commandes générées.
7. Les deltas SOL des acteurs correspondent exclusivement au loyer déboursé à la création ou intégralement rendu au client à la fermeture. Les autres acteurs ne reçoivent aucun loyer.

Les horloges restent monotones. Le rapport distingue `boundariesRequested` (intentions), `boundariesReached` (écarts réellement observés depuis une frontière valide), `boundariesClamped` (recul interdit ou limite i64) et `boundariesUnavailable` (mission/verdict/litige absent). Par exemple, demander -1 alors que l'horloge est déjà à la borne compte comme demande -1, atteinte 0 et ajustement monotone ; cela ne compte jamais comme une visite à -1. Les traces conservent timestamps demandé/réel, référence et motif d'ajustement.

Le générateur vise les instants juste avant, exactement à et juste après deadline, fin de fenêtre, sept jours de stale et quatorze jours de litige. Les exemples initiaux imposent les frontières avant/exactes des sorties ; les sauts aléatoires les combinent avec les autres actions. Les valeurs proches de la limite i64 passent également par les garde-fous d'overflow.

## Artefacts et régressions

`coverage/fuzz/summary.json` contient graine, moteur, SHA-256 SBF/IDL, durée, séquences réellement évaluées, instructions, réussites/refus, vérifications et compteurs par instruction. Le champ `corpus` donne les nombres d'exemples fixes et de régressions ; `requestedSequenceCounts` donne leur répartition attendue avec les séquences générées. `sequenceCounts` conserve, pour chaque catégorie, les nombres commencés, réussis et échoués. Les réductions et les relectures explicites ont leur catégorie distincte ; un worker interrompu reste commencé sans résultat. En cas d'échec, `sequences` inclut les évaluations de réduction et `numShrinks` est ajouté lorsque fast-check termine. Une relecture par `--path` est comptée comme telle, sans inventer sa catégorie d'origine. Les instructions SPL de préparation ne sont pas comptées ; `initialize_config` et son contrôle d'invariants le sont.

`summary.json` et `progress.json` sont écrits avant chaque worker et actualisés après son résultat. Dès le premier échec, puis immédiatement à chaque réduction échouée, les fichiers ci-dessous sont mis à jour par écriture atomique avec synchronisation disque. Chaque échec possède aussi un instantané `failure-<évaluation>.json` ; les candidats de réduction réussis ont un instantané `reduction-<évaluation>.json`. Une interruption conserve donc les dernières preuves complètes, leur graine et leur statut provisoire. Un `SIGKILL` ne peut pas fournir une trace d'une instruction native restée en cours ; il laisse le candidat courant dans `progress.json` et les échecs précédents intacts.

Un échec produit aussi :

- `failure.json` : graine, chemin fast-check, erreur et commande de reproduction ;
- `minimal-sequence.json` : dernier contre-exemple réduit connu ; la réduction n'est déclarée terminée que lorsque `status` vaut `complete` ;
- `failure-trace.json` : décisions du modèle et traces du dernier contre-exemple échoué.

Le premier run de durcissement a conservé une [régression du harnais](../../tests/fuzz/regressions/README.md) : conversion décimale BN incorrecte observée, alors que le vault exact passait. La cause interne de cette conversion n'est pas établie. La séquence de 66 commandes est conservée sans la présenter comme minimale ; la réduction avait été interrompue par le délai CI. Une erreur du modèle ou du harness n'est pas présentée comme une faille du programme. Si un vrai défaut SBF est découvert, sa séquence réduite est conservée dans `tests/fuzz/regressions/`, puis sa correction est faite dans un commit séparé. Aucun échec n'est supprimé ou ignoré pour faire passer la CI.

## Portée et limites explicites

- **Dons exclus de l'alphabet.** Un transfert SPL externe vers un vault augmente légitimement son solde. L'invariant « exact » porte donc sur les seules instructions escrow ; les tests déterministes existants couvrent déjà le balayage de dons. Aucun mint/burn n'est permis après la préparation.
- **Identifiants.** Le programme permet historiquement la réutilisation d'une PDA après fermeture. L'invariant 4 s'applique aux séquences utilisant le SDK et son historique sans réutilisation, pas à une interdiction on-chain inexistante.
- **Rotation.** Désigner comme validateur une partie d'une mission déjà engagée reste possible. L'invariant 6 vérifie les portes d'entrée sous le mandat courant, pas une exclusion rétroactive fictive.
- Les comptes SPL, autorité loader et financements de test sont préparés localement. Les transitions étudiées exécutent les instructions SBF/SPL réelles. Les tests ne couvrent pas consensus, forks, RPC distribué, concurrence réseau, Squads CPI, comportement d'un indexeur, véracité documentaire ou sécurité d'une machine compromise.
- Le nombre fini de séquences n'est ni une preuve formelle ni une couverture de lignes/branches Rust. Les résultats sont ceux des graines et du binaire indiqués, sans revendication d'audit indépendant.

Sources : [fast-check : générateurs et réduction](https://fast-check.dev/docs/core-blocks/arbitraries/), [configuration et reproduction](https://fast-check.dev/docs/configuration/), [machine d'états MULE](../state-machine.md).
