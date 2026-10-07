# @mule/console-core

Ce module exécute dans le navigateur les vraies fixtures MULE, l'agent de référence scripté, le validateur déterministe et le JSON canonique partagés avec les paquets Node. Les empreintes SHA-256 couvrent les octets UTF-8 exacts, y compris le LF final, et sont calculées exclusivement par WebCrypto.

Il ne contacte aucun réseau, portefeuille ou chaîne et ne manipule aucun fonds réel. Les soldes sont des entiers `bigint` en unités fictives à six décimales. `SIM-TX-…` désigne explicitement une opération simulée, jamais une signature. Le module n'est **pas le programme Anchor** : son modèle TypeScript indépendant est comparé au vrai SBF dans les tests différentiels locaux de la CI.

## Utilisation

Le fichier autonome à consommer est `dist/console-core.mjs`, accompagné de `dist/console-core.mjs.sha256`. Le paquet reste privé ; ces fichiers sont versionnés dans ce dépôt, sans publication sur un registre.

```js
import { runMission } from './console-core.mjs';

for await (const step of runMission('invoice', 'dishonest')) {
  console.log(step.station, step.text);
}
```

`runMission(template, behavior): AsyncIterable<Step>` accepte `invoice | contract | address` et `honest | dishonest`. Il conserve les cinq stations, `text`, `failed?` et `outcome?: 'settled' | 'returned'`. Les deux champs additionnels facultatifs sont `hashes: {criteria, delivery, report}` (SHA-256 complets en hexadécimal) et `report` (objet JSON du validateur). Ils sont fournis aux stations 4 et 5. L'affichage emploie `sha256:abcd…1234` et les messages exacts du validateur. L'appelant gère les délais et la présentation ; le module n'attend pas artificiellement entre les stations.

`prepareMission(template, behavior, options?)` expose les données pour l'inspection et les tests :

- `artifacts.criteria`, `artifacts.delivery`, `artifacts.report` : chacun contient `value`, `json` canonique et `hash` ;
- `trace` : les cinq instructions `create_mission`, `accept_mission`, `submit_delivery`, `record_verdict`, `finalize`, avec rôle, horloge, états avant/après et deltas client/agent/vault ;
- `final` : statut, soldes, agent symbolique et empreinte du rapport conservée pour l'inspection ;
- `parameters` et `missionReference` : les entrées exactes du scénario.

Les valeurs par défaut sont `amount: 5_000_000n`, `now: 1_700_000_000n`, `deadline: now + 600n`, `window: 60n`, soldes initiaux client `100_000_000n` et agent `0n`, et aucune désignation. `missionReference` vaut `SIM-MISSION-<template>-<behavior>` ; une référence personnalisée doit conserver ce préfixe symbolique. `designatedAgent: 'agent'` active le scénario désigné. Les soldes, échéances et fenêtres personnalisés doivent rester dans les domaines u64/i64 et respecter les règles du modèle.

Le modèle expose six méthodes : `create`, `accept`, `submit`, `recordVerdict`, `finalize`, `refund`. La dernière couvre les chemins `refund_expired` et `refund_stale`. Les rôles sont `client`, `agent`, `validator`, `outsider`. La rubrique de solde `agent` représente la partie acceptée ; ses identifiants restent symboliques. Un refus lève `EscrowModelError` et ne modifie ni l'état ni la trace.

## Reconstruction et contrôles

Depuis la racine, avec Node et pnpm aux versions verrouillées du dépôt :

```sh
pnpm install --frozen-lockfile
pnpm build:console
pnpm check:console-bundle
pnpm --filter @mule/console-core test
pnpm test:console-browser
pnpm test:console-differential
```

La reconstruction compile d'abord `@mule/mission-logic`, régénère les fixtures et les validateurs, puis produit les déclarations TypeScript et le module ES unique. Le test navigateur exige Chromium Playwright disponible ; le test différentiel exige Linux/Node 24 et les fichiers SBF/IDL assortis. Il n'exécute rien sur un cluster public. Les tests unitaires du paquet ne nécessitent pas LiteSVM.

Les validateurs [Ajv standalone](https://ajv.js.org/standalone.html) sont générés **au build** par `scripts/generate-console-data.mjs`. À l'exécution, aucun schéma n'est compilé et aucun `eval`/`new Function` n'est nécessaire. La CI inspecte le bundle, le rejoue dans un navigateur avec CSP stricte, reconstruit les mêmes octets et impose au plus 40 Ko gzip. Le fichier `.sha256` et le check-in donnent l'empreinte et les tailles du fichier effectivement construit.

## Portée de la comparaison

Les tests différentiels comparent les trois modèles × deux comportements, plus une mission avec agent désigné : états successifs, deltas SPL, état terminal, message du validateur et `report_hash`. Le rapport est créé avec la même référence symbolique dans les deux environnements ; les clés de test du SBF ne sont jamais introduites dans les artefacts de console. Les JSON et les SHA-256 sont aussi comparés octet par octet aux sorties du runner Node et au navigateur.

Cette comparaison démontre l'accord **sur les scénarios et le binaire testés**, pas une équivalence universelle de toutes les entrées possibles. Les tests unitaires supplémentaires contrôlent les mauvais rôles, bornes, refus sans mutation, remboursements d'expiration/stale et débordements `bigint` ; ils ne remplacent pas un test SBF pour chaque combinaison.

Le modèle ne simule ni comptes/PDA, signatures, frais SOL ou loyers, ni rotation/transfert d'administration, litiges, dépôts externes au vault, consensus ou concurrence. La fenêtre de 60 secondes est la configuration locale des scénarios ; le défaut du programme reste 3 600 secondes. Un objet `EscrowModel` représente une seule mission ; après clôture, il conserve un état terminal d'inspection et ne crée pas une nouvelle identité. Le programme, lui, clôture ses comptes et permet historiquement la réutilisation d'identifiants : ce module n'affirme pas l'interdire on-chain.

Sources : [machine d'états](../../docs/state-machine.md), [fixtures](../../fixtures/README.md), [modèle indépendant](src/model.ts), [module partagé](../mission-logic/src/index.ts). La partie B (intégration du site) est distincte et n'est pas incluse ici.
