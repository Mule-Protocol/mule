# CHECK-IN 5a — console-core, partie A

Date : 8 octobre 2026 (Europe/Paris). **Partie A validée par la CI. PR en brouillon, aucune fusion. Partie B non commencée.**

## Périmètre, références et commits

La [demande M-1.2](../spec/M1_2_REAL_LOGIC_CONSOLE.md) porte ici uniquement sur le dépôt `Mule-Protocol/mule`. Le paquet fournit la logique de mission utilisable dans le navigateur ; il ne modifie ni ne déploie `mule-site`. La partie B reste différée jusqu'à l'instruction explicite du propriétaire « Fais la partie B », accompagnée du commit de fusion de la partie A.

- [PR #31](https://github.com/Mule-Protocol/mule/pull/31), branche `codex/m1-2-console-core`, créée depuis main [eb57310a17a3cc7a28de334ccae45a8f069ca3a8](https://github.com/Mule-Protocol/mule/commit/eb57310a17a3cc7a28de334ccae45a8f069ca3a8).
- [Milestone M-1.2 · Real-logic console](https://github.com/Mule-Protocol/mule/milestone/3).
- [Issue #26 — partie A](https://github.com/Mule-Protocol/mule/issues/26) ; [issue #27 — partie B différée](https://github.com/Mule-Protocol/mule/issues/27).

| Commit | Contenu |
| --- | --- |
| [b5d932c3fabe5e704a9e65f5aa5a2104c624c46a](https://github.com/Mule-Protocol/mule/commit/b5d932c3fabe5e704a9e65f5aa5a2104c624c46a) | Extraction de la logique pure commune aux paquets Node et au navigateur. |
| [ecc37289d3beaedc078ee9cd2d8661042f307c21](https://github.com/Mule-Protocol/mule/commit/ecc37289d3beaedc078ee9cd2d8661042f307c21) | Paquet navigateur, modèle d'escrow, fixtures et validateurs standalone, bundle autonome. |
| [3b1e17cce5e4ff39d420acf437019b1898130fae](https://github.com/Mule-Protocol/mule/commit/3b1e17cce5e4ff39d420acf437019b1898130fae) | Tests différentiels SBF, parité Node/navigateur, Chromium et contrôles CI. |
| [3f74304d9775abb157752bcd844a2be159ba2d05](https://github.com/Mule-Protocol/mule/commit/3f74304d9775abb157752bcd844a2be159ba2d05) | Même référence symbolique de mission dans les trois pipelines de comparaison. |

Le commit de publication du présent rapport et des preuves est identifiable dans l'[historique de la PR](https://github.com/Mule-Protocol/mule/pull/31/commits). Aucun amend, rebase, force-push ou fusion.

## État des vérifications

**CI verte : [run 37700019985](https://github.com/Mule-Protocol/mule/actions/runs/37700019985), commit `3f74304d9775abb157752bcd844a2be159ba2d05`. Les cinq jobs `verify`, `audit`, `local-missions`, `fuzz` et `console-core` ont réussi.** Les commits suivants publient la documentation et les preuves.

Le [premier run 37699778340](https://github.com/Mule-Protocol/mule/actions/runs/37699778340) a été annulé automatiquement par le nouveau commit et la règle de concurrence du workflow. Cette annulation n'est pas présentée comme un échec de test.

| Contrôle | Résultat CI |
| --- | --- |
| Tests unitaires des paquets | **85/85** : 65 existants, 16 console, 4 standalone |
| Comparaisons Node/Ajv runtime contre standalone | **33 rapports complets**, plus les trois fixtures, dans les quatre tests versionnés |
| Tests de la politique statique du bundle | **2/2** |
| Parité portable runner Node / bundle | **7/7** |
| Chromium réel 153.0.8010.12 | **7/7** avec les références finales identiques |
| Différentiel modèle / vrai SBF | **7/7** sous LiteSVM 0.8.0 / Linux / Node 24 |
| Suite SBF historique | **53/53**, programme Anchor inchangé |
| Bundle et reconstruction | **13 134 octets gzip**, reconstruction identique au fichier versionné |
| Audit de dépendances | Réussi avec l'exception conditionnelle bigint-buffer préexistante |
| Campagne locale et fuzz hérités | Jobs réussis |

Preuves : [statut du run](../testing/CONSOLE-5a/ci-run.json), [job console-core](https://github.com/Mule-Protocol/mule/actions/runs/37700019985/job/113061994512), [artefact public](https://github.com/Mule-Protocol/mule/actions/runs/37700019985/artifacts/11517002720), [différentiel SBF](../testing/CONSOLE-5a/console-differential/summary.json), [Chromium](../testing/CONSOLE-5a/console-browser/summary.json), [bundle](../testing/CONSOLE-5a/console-bundle.json) et [audit](../testing/CONSOLE-5a/audit-summary.json).

## Logique réutilisée et interface publique

Le [module pur partagé](../../packages/mission-logic/src/index.ts) contient les types, `canonicalJson`, `ScriptedAgent`, la comparaison décimale exacte et `createValidator({ fixtureFor, schemaValidator })`. Les paquets Node utilisent ces mêmes fonctions ; leurs API restent disponibles. Les tests Node préexistants ne sont pas remplacés par une nouvelle simulation.

Les trois modèles viennent des [fixtures sources](../../fixtures/README.md). Le [générateur de build](../../scripts/generate-console-data.mjs) produit les fixtures embarquées et **14 validateurs de schémas uniques** : schémas globaux, propriétés et objets/éléments de lignes. Node garde Ajv 8.20.0 à l'exécution ; le navigateur reçoit le code standalone avec les mêmes options, les mêmes erreurs et le seul format `date` fourni par ajv-formats 3.0.1. Il ne compile aucun schéma au runtime. Les références aux helpers purs nécessaires sont intégrées au module ES final.

`canonicalJson` conserve le tri des clés, l'encodage UTF-8 et le LF final ; il rejette les valeurs que JSON perdrait ou convertirait silencieusement. Le navigateur calcule les trois SHA-256 avec `crypto.subtle.digest('SHA-256')`.

L'interface exportée reste :

```ts
runMission(
  template: 'invoice' | 'contract' | 'address',
  behavior: 'honest' | 'dishonest',
): AsyncIterable<Step>
```

`Step` conserve `station`, `text`, `failed?` et `outcome?`, avec `hashes?` et `report?` en plus. Les cinq stations conservent leur format et les messages exacts du validateur. Les textes présentent les empreintes sous la forme `sha256:abcd…1234`, et les opérations sous `SIM-TX-LOCK-…` / `SIM-TX-CLOSE-…`, jamais une signature ou adresse Solana réelle. Le consommateur garde la responsabilité du rythme d'affichage ; aucune intégration du site n'est effectuée ici.

[Documentation d'utilisation et de reconstruction](../../packages/console-core/README.md).

## Différentiel modèle / SBF, scénario par scénario

**7/7 scénarios réussis, aucun écart observé sur ces vecteurs.** La [liste de scénarios unique](../../tests/console-differential/scenarios.json) alimente les tests portable, Chromium et LiteSVM. Les [preuves CI](../testing/CONSOLE-5a/console-differential/summary.json) totalisent **70 observations d'état avant/après** et **35 comparaisons de deltas**, soit dix observations et cinq deltas par scénario.

| Scénario et preuve | États observés après chaque instruction, identiques | Message exact Node = navigateur | Différentiel final | report_hash console = on-chain |
| --- | --- | --- | --- | --- |
| [invoice / honest](../testing/CONSOLE-5a/console-differential/invoice-honest.json) | open → accepted → submitted → passed → settled | 6/6 FIELDS VALID | Réussi | `24bebc6d6cf244296d79d550a5a0103d2ad5b5da6fe843f75a3ad90dc21230b7` |
| [invoice / dishonest](../testing/CONSOLE-5a/console-differential/invoice-dishonest.json) | open → accepted → submitted → failed → refunded | 5/6 · MISSING: total_amount | Réussi | `d0916655daaa815b0bb0283eb44e3f688898c18ef74c5c3a0dcf568489919710` |
| [contract / honest](../testing/CONSOLE-5a/console-differential/contract-honest.json) | open → accepted → submitted → passed → settled | 5/5 FIELDS VALID | Réussi | `23a95be05289196b66ae237cf8fff9a834a0c0fa2880e64b3c99a032b0813886` |
| [contract / dishonest](../testing/CONSOLE-5a/console-differential/contract-dishonest.json) | open → accepted → submitted → failed → refunded | 4/5 · MISSING: governing_law | Réussi | `ea5c542098cabc13e6d87cd0c46cc709208319390db5ebc57ebc031ff21850da` |
| [address / honest](../testing/CONSOLE-5a/console-differential/address-honest.json) | open → accepted → submitted → passed → settled | 12/12 ROWS VALID | Réussi | `0430753bc25ae77fc674d0b6c8d0c9bf8a16ae43f1de4b753853f326e65eaddf` |
| [address / dishonest](../testing/CONSOLE-5a/console-differential/address-dishonest.json) | open → accepted → submitted → failed → refunded | 11/12 · INVALID POSTCODE, ROW 7 | Réussi | `16f88af6d2436ddf1d3bc6dafb51d4fb43f82dd8a3ef5bb3fb430c5d1227cdbe` |
| [invoice / honest, agent désigné](../testing/CONSOLE-5a/console-differential/invoice-designated.json) | open → accepted → submitted → passed → settled | 6/6 FIELDS VALID | Réussi | `4bc5292a24c79b782edaaf7b6c35f4dbd5a8f4b07d7bee2c2eaf24265468cefd` |

Le message est comparé entre le vrai validateur Node utilisé par le scénario SBF et le validateur navigateur. **Anchor ne calcule ni ne stocke ce texte** : il enregistre le verdict et le `report_hash`. L'égalité de cette empreinte lie le rapport complet, dont le message fait partie.

Chaque scénario part de **100 000 000 unités client**, **0 agent**, **0 vault**, pour une mission de **5 000 000 unités fictives**. Les deltas observés, identiques dans le modèle et le SBF, sont :

| Instruction | Delta client / agent / vault observé |
| --- | --- |
| create_mission | −5 000 000 / 0 / +5 000 000 |
| accept_mission, submit_delivery, record_verdict | 0 / 0 / 0 à chaque instruction |
| finalize après Passed | 0 / +5 000 000 / −5 000 000 |
| finalize après Failed | +5 000 000 / 0 / −5 000 000 |

Les soldes finaux sont **95 000 000 / 5 000 000 / 0** pour les quatre paiements et **100 000 000 / 0 / 0** pour les trois remboursements. Le cas désigné confirme aussi le refus `NotDesignatedAgent` d'un tiers dans les deux environnements, sans changement d'état ni de solde, puis l'acceptation par l'agent prévu.

Le [worker différentiel](../../tests/console-differential/worker.ts) charge le **bundle publié** et le **vrai SBF**, avec SPL Token dans LiteSVM. Il compare avant/après chacune des cinq instructions les états et soldes, puis les deltas, les événements, le statut terminal et le `report_hash` réellement enregistré dans Mission et dans l'événement VerdictRecorded. Les sept scénarios ferment les deux comptes ; côté SBF, les **7 579 440 lamports** de loyer déposés par scénario sont intégralement rendus au client. Après clôture, le statut terminal vient de l'événement réussi ; les champs agent/report_hash relus avant clôture sont conservés pour la comparaison. Aucun compte fermé n'est présenté comme encore vivant.

Empreintes des fichiers exécutés, données dans la [preuve CI](../testing/CONSOLE-5a/console-differential/summary.json) :

- SBF : `7c93e61315ea26fcb7092380ffe02a7efba7c938e9c66e197dbc7b3db4381ab8`, identique au check-in 4.
- IDL : `0bf513e2d5138be9b4eeb44c3814aa04176ec3329444924213d528ce68275cba`.

Le script interdit l'exécution native sous Windows et isole chaque scénario dans un processus Linux / Node 24, sans relance silencieuse après échec.

## Parité Node / navigateur au même octet

Les mêmes entrées parcourent :

1. le vrai agent Node, `LocalContentStore` et `prepareValidationReport` du runner ;
2. le bundle autonome et ses validateurs standalone ;
3. ce même bundle dans Chromium réel.

Pour chaque scénario, les trois JSON **critères, livraison, rapport** ont exactement les mêmes valeurs, octets UTF-8, LF final et SHA-256 dans les comparaisons exécutées. Le test recalcule aussi les empreintes indépendamment côté Node. Dans chaque harnais, les sept scénarios donnent **21 comparaisons de JSON** et **21 comparaisons d’empreintes**.

| Scénario | Node / bundle portable | Chromium / Node : JSON + SHA | Octets UTF-8 critères / livraison / rapport |
| --- | --- | --- | ---: |
| invoice / honest | Réussi | Identiques | 863 / 237 / 887 |
| invoice / dishonest | Réussi | Identiques | 863 / 213 / 1 089 |
| contract / honest | Réussi | Identiques | 609 / 226 / 734 |
| contract / dishonest | Réussi | Identiques | 609 / 197 / 921 |
| address / honest | Réussi | Identiques | 657 / 1 373 / 1 143 |
| address / dishonest | Réussi | Identiques | 657 / 1 375 / 1 379 |
| invoice / honest, agent désigné | Réussi | Identiques | 863 / 237 / 891 |

Les [preuves Chromium](../testing/CONSOLE-5a/console-browser/summary.json) et [données de parité](../testing/CONSOLE-5a/console-browser/parity.json) donnent les trois empreintes complètes par scénario. Les messages et statuts finaux correspondent au tableau différentiel ci-dessus. L'interface des cinq étapes de `runMission` est vérifiée pour les six combinaisons publiques ; le septième vecteur désigné vérifie la préparation des artefacts et le modèle d'escrow.

La référence de mission fait partie des octets du rapport. Les comparaisons injectent donc partout `SIM-MISSION-<id du scénario>`, y compris `SIM-MISSION-invoice-designated`. Le commit `3f74304` corrige une divergence entre les références des vecteurs navigateur et SBF ; il ne corrige ni le modèle d'escrow ni le programme. L'ancien hash du scénario désigné n'est pas une preuve valable pour ce vecteur corrigé.

Cette injection concerne uniquement les entrées du test de parité : la fonction opérationnelle Node `validateMission` continue à fournir sa vraie PDA comme référence de rapport lors d'une campagne locale. Le bundle de console ne reçoit aucune clé ni adresse réelle.

Le [test standalone versionné](../../packages/validator/test/standalone-parity.test.ts) ajoute **33 comparaisons de rapports complets** : onze par modèle, avec sorties honnêtes/malhonnêtes, racines JSON invalides, entrées avant normalisation, champs supplémentaires et dates impossibles. Il vérifie aussi que les fixtures générées égalent les sources et que les schémas inconnus ou critères affaiblis ne déclenchent aucune compilation de secours.

## Bundle, taille et absence de compilation dynamique

Fichier destiné à une future intégration du site : [console-core.mjs](../../packages/console-core/dist/console-core.mjs), accompagné de [console-core.mjs.sha256](../../packages/console-core/dist/console-core.mjs.sha256). Ils sont versionnés ; aucune publication npm ni mise en production n'est effectuée.

| Mesure | Résultat CI confirmé |
| --- | --- |
| Taille brute | **72 364 octets** |
| Taille gzip, niveau 9 | **13 134 octets** |
| Budget gzip | **40 000 octets maximum**, respecté |
| Reconstruction | Octets identiques au fichier versionné |
| SHA-256 | `11fd73a2ee21035ff8fe07f696e0c13ef979bed055f8ce4bb33c58ffc368f47c` |

Les mesures locales et celles de la [preuve CI du bundle](../testing/CONSOLE-5a/console-bundle.json) coïncident.

Le [build](../../scripts/build-console-core.mjs) emploie esbuild **0.25.12**, produit un seul module ES, conserve les notices des helpers tiers et vérifie sa taille compressée. Le contrôle CI reconstruit le bundle, compare ses octets et son fichier d'empreinte, puis vérifie que les fichiers versionnés n'ont pas changé.

La [politique statique](../../scripts/console-bundle-policy.mjs) analyse l'AST du **bundle émis**, pas seulement ses sources. La preuve CI parcourt **15 790 nœuds** et relève **0 import externe/dynamique, 0 eval, 0 constructeur Function, 0 référence Node interdite, 0 API réseau interdite**. Les identifiants et accès calculés littéraux interdits sont rejetés ; deux tests vérifient les refus. Le build refuse également l'entrée de code SDK/runner dans le bundle. La [preuve versionnée CI](../testing/CONSOLE-5a/console-bundle.json) confirme ces compteurs nuls.

Le [test Chromium](../../scripts/test-console-browser.mjs) ajoute une preuve d'exécution :

- chargement initial du module et d'un harnais externe depuis un serveur de test loopback, avec CSP sans `unsafe-eval` ni `unsafe-inline` et `connect-src 'none'` ;
- contrôle négatif séparé : un clic tente un constructeur `Function` dans le **harnais**, hors bundle ; la CSP doit le bloquer et produire la violation attendue ;
- remise à zéro des observations, passage du contexte hors ligne, puis lancement des missions par un autre clic ;
- aucune violation CSP, erreur navigateur ni tentative de requête réseau admise pendant l'exécution des missions.

Le constructeur interdit du contrôle négatif ne fait pas partie du fichier publié. Les chargements initiaux du harnais ne sont pas comptés comme des appels du module pendant une mission. La [preuve Chromium 153.0.8010.12](../testing/CONSOLE-5a/console-browser/summary.json) confirme le blocage du contrôle négatif, puis **zéro violation CSP, zéro erreur navigateur et zéro tentative de requête réseau** pendant les sept scénarios exécutés hors ligne. La violation `script-src` / `eval` du contrôle séparé est attendue et exclue des observations de mission.

## Écarts, portée et arrêt

- Aucun écart de comportement modèle/programme n'a été observé sur les sept scénarios exécutés. L'uniformisation des références symboliques de test est décrite ci-dessus ; **aucune modification du programme Anchor n'est effectuée**.
- Les résultats différentiels portent sur sept scénarios et le binaire désigné, pas sur une équivalence universelle de toutes les entrées. Les tests unitaires du modèle ajoutent refus de rôles, bornes temporelles, expiration/stale et débordements ; ils ne constituent pas une preuve SBF pour toutes ces combinaisons.
- Le modèle ne représente ni comptes/PDA, signatures, frais SOL ou loyers, ni litiges, rotation/transfert d'admin, dons au vault, consensus ou concurrence. Les assertions de loyer/fermeture appartiennent à la branche SBF du test. La fenêtre de 60 secondes est celle du scénario local ; le défaut on-chain reste 3 600 secondes.
- Après clôture, l'objet conserve un résultat d'inspection. Cela ne crée pas de protection on-chain contre la réutilisation d'un identifiant, historiquement autorisée après fermeture des comptes.
- Les fixtures, l'agent et le validateur vérifient les règles encodées. Ils ne prouvent pas l'authenticité d'une facture, d'un contrat ou d'une adresse.
- Les contrôles hérités restent soumis à leurs limites documentées : l'[audit CI](../testing/CONSOLE-5a/audit-summary.json) compte une alerte npm high pour bigint-buffer 1.1.5, couverte par l'exception conditionnelle préexistante (mode JavaScript seul vérifié, réexamen le 6 novembre 2026), sans alerte critical/moderate/low. Le service interne Agave à balance/plafonds zéro reste dans le job local historique accepté. Le paquet console lui-même ne contacte aucun réseau ni faucet et ne possède aucun wallet.
- Aucune partie B, modification de `mule-site`, intégration de production, modification DNS/Cloudflare/CSP du site ou mesure Lighthouse du site n'est réalisée. Ces opérations attendent l'autorisation explicite après fusion de A par le propriétaire.
- Aucun déploiement de programme, réseau Solana public, service payant, API d'IA, secret GitHub, opération `$MULE`, modification des protections de branche, fusion de PR ou réécriture d'historique.

Au contrôle final, le dépôt est public, la PR #31 est toujours en brouillon et non fusionnée, main reste à `eb57310a17a3cc7a28de334ccae45a8f069ca3a8`, et aucun secret GitHub n'est configuré. Les différences du programme Anchor, de l'IDL, de Cargo.lock et d'Anchor.toml sont nulles ; le checkout `mule-site` est propre.

**Arrêt au check-in A. Ne pas commencer la partie B.**
