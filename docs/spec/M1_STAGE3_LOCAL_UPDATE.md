# M-1 · Étape 3 : validateur, agent et runner sur un réseau local

La PR #6 est fusionnée dans `main` (commit `6a47c49`). Le check-in 1b est validé.

Le périmètre reste celui de `docs/spec/M1_LOCAL_ONLY_UPDATE.md` : aucun déploiement, ni devnet ni ailleurs, et tout le travail se fait sur GitHub. Les spécifications de `docs/spec/` font foi pour les modèles de mission, les messages d'échec, le validateur (§5) et l'agent (§6), sauf sur les points que ce message remplace.

Travaille sur une nouvelle branche créée depuis `main`, dans une PR en brouillon liée à l'issue de l'étape 3 du milestone. Fais des commits explicites, sans réécriture d'historique. Arrête-toi au check-in 3. Ne fusionne pas.

## 0. Correctif du programme (commit séparé, en premier)

**Problème :** rien n'empêche le validateur d'être partie prenante d'une mission. Il pourrait juger son propre travail comme agent, ou refuser une livraison honnête comme client pour se faire rembourser.

**À faire :**
- `create_mission` refuse :
  - `client == config.validator` ;
  - `designated_agent == Some(config.validator)`.
- `accept_mission` refuse `actor == config.validator`.
- Ajoute le compte `config` au contexte s'il manque.
- Crée des erreurs nommées pour ces refus.
- Mets à jour l'IDL, le SDK, `docs/state-machine.md` et `docs/threat-model.md`.
- **Tests LiteSVM :**
  - les trois refus ;
  - après un `update_config` qui change le validateur, l'ancien validateur peut de nouveau être client ou agent, et le nouveau ne le peut plus.

## 1. Paquets

Crée ces paquets, avec leurs tests dans la CI :
- **`packages/validator`**
- **`packages/agent`**
- **`packages/runner`**
- **`fixtures/`** pour les trois modèles.

**Validateur :**
- **Règles :** il est déterministe et ne fait appel à aucune IA. Il utilise Ajv (JSON Schema 2020-12) et les contrôles croisés de la spec.
- **Les trois modèles :** `invoice.v1`, `contract.v1` et `address.v1`.
- **Messages d'échec :** ils sont exactement ceux de la console :
  - `5/6 · MISSING: total_amount`
  - `4/5 · MISSING: governing_law`
  - `11/12 · INVALID POSTCODE, ROW 7`
- **Rapport :** il est écrit dans `data/`, et son sha256 est le `report_hash` envoyé on-chain.

**Agent scripté :**
- **Modes :** il est déterministe, avec un mode `honest` et un mode `dishonest`.
- **Mode `dishonest` :** il corrompt exactement une valeur requise par modèle :
  - pour une facture, il retire `total_amount` ;
  - pour un contrat, il retire `governing_law` ;
  - pour les adresses, il rend invalide le code postal de la ligne 7.
- **Interface :** la production de la livraison passe par une interface qui permettra plus tard de brancher un vrai modèle sans toucher au reste.
- **Aucun appel à une API d'IA.**
- **Dans le README et les rapports :** « agent de référence scripté ».

**Stockage :**
- Les critères, livraisons et rapports sont stockés dans `data/<sha256>.json`.
- L'URI on-chain est `https://raw.githubusercontent.com/Mule-Protocol/mule/main/data/<sha256>.json`. Vérifie qu'elle ne dépasse pas 200 octets.
- En local, le résolveur lit `data/` et non le réseau.
- Tout fichier lu est re-haché et rejeté si l'empreinte ne correspond pas.

## 2. Réseau local

**Validateur Solana :** le runner utilise `solana-test-validator`, issu de l'archive Agave 2.3.0 déjà épinglée et vérifiée par SHA-256 dans la CI. Il est lancé dans le job lui-même :
- avec le programme compilé chargé comme programme **upgradeable** ;
- avec une autorité d'upgrade éphémère, pour que `initialize_config` passe la vérification de l'autorité.

**Clés :**
- Toutes les clés sont générées dans le job, pour ce run seulement : admin, validateur, client, agent, autorité du mint.
- Elles ne vont jamais dans le dépôt, les logs, les artefacts ni les secrets GitHub.

**Mise en place, par script :**
- un mint local « dUSDC » ;
- `initialize_config` ;
- puis `update_config` avec `min_dispute_window = 60`, pour ce réseau local uniquement. La valeur par défaut du programme ne change pas.

**URL RPC :** c'est un paramètre. Rien n'est codé en dur sur localhost. Le même code devra fonctionner plus tard en changeant seulement cette URL.

**Ordre d'exécution du runner :**

> création → acceptation → livraison → verdict → `finalize` / `resolve_dispute` / `refund_expired`

La commande `sweep` règle tout ce qui est dû : `finalize`, `refund_expired` et `refund_stale`.

## 3. Les 10 missions (check-in 3)

| # | Mission | Résultat attendu |
| --- | --- | --- |
| 1-6 | 3 modèles × `honest` / `dishonest` | honnêtes payées ; malhonnêtes remboursées, avec le bon message d'échec |
| 7 | facture honnête, réservée à un agent désigné | payée à l'agent désigné |
| 8 | litige ouvert par le client sur un verdict Passed, résolu par l'admin | selon la résolution, avec le bon destinataire |
| 9 | mission jamais acceptée, échéance courte | `refund_expired`, client remboursé |
| 10 | mission acceptée puis jamais livrée | `refund_expired`, client remboursé |

**Vérifications pour chaque mission :**
- soldes du client et de l'agent avant et après ;
- vault fermé ;
- loyer rendu ;
- statut final ;
- signatures des transactions.

**Ce qui ne peut pas tourner en temps réel :** `refund_stale` (7 jours) et le délai de litige (14 jours) ne peuvent pas s'écouler sur un réseau local. Ils restent couverts par LiteSVM avec une horloge avancée. Teste aussi la commande `sweep` sur ces deux cas, avec une horloge simulée. Le rapport dit clairement ce qui a tourné sur le réseau local et ce qui est couvert par LiteSVM.

## 4. Idempotence

Ajoute une injection de panne par variable d'environnement, réservée aux tests, à deux endroits :
- **(a)** après l'écriture du rapport, avant l'envoi du verdict ;
- **(b)** après la confirmation du verdict, avant la mise à jour de l'état local.

**Résultat attendu à la relance :**
- un seul verdict on-chain ;
- le même `report_hash` ;
- aucune transaction en double ;
- aucune mission bloquée.

Le validateur relit l'état de la mission on-chain avant d'agir.

## 5. CI et traces

**CI :**
- Ajoute un job ou un workflow `local-missions` qui lance les 10 missions sur chaque PR et sur `push` vers `main`.
- Il produit `runs/local-<date>-<run>.md` comme artefact : un tableau avec modèle, mode, message du validateur, issue, soldes et signatures.
- Le workflow garde `permissions: contents: read`, sans secret et sans push depuis la CI.

**Rapport versionné :** committe dans la PR un rapport de référence, avec les fichiers `data/` qu'il référence.

**Documentation :**
- un `docs/runbook-local.md` qui explique comment lancer les 10 missions en une commande sur une machine de développeur ;
- mets aussi à jour le README et `docs/architecture.md`.

**Issues :**
- Sur les issues des étapes 2, 4 et 5, ajoute un commentaire « Reportée : voir docs/spec/M1_LOCAL_ONLY_UPDATE.md ». Ne les ferme pas.

## Rapport

Écris `docs/checkins/CHECKIN-3.md` avec :
- les commits ;
- le lien du run CI vert ;
- le tableau des 10 missions ;
- la preuve que chaque mission malhonnête a été remboursée ;
- les preuves d'idempotence ;
- ce qui est couvert par LiteSVM et ce qui l'est par le réseau local ;
- la couverture par instruction mise à jour ;
- les écarts avec ces consignes ;
- ce que tu n'as pas pu vérifier.

Puis arrête-toi.

## Interdits

- Pas de devnet, de mainnet, de faucet, de secrets GitHub ni de service payant.
- Pas d'API d'IA.
- Rien qui touche à `$MULE` ni à `mule-site`.
- Pas de fusion, pas de force-push, pas de changement des protections de branche.
