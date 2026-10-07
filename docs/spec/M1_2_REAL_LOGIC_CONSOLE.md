# M-1.2 · La console du site tourne sur la vraie logique du protocole

La PR #21 est fusionnée dans `main` (commit `eb57310`). Le check-in 4 est validé.

**Objectif :** la console de muleprotocol.com exécute le vrai code de MULE, à la place de la simulation codée en dur de `mule-site/src/lib/run-mission.ts`. Ce fichier le prévoit déjà : « M-1 replaces this implementation ». Le vrai code, c'est :
- les vraies fixtures ;
- le vrai agent scripté ;
- le vrai validateur ;
- les vraies empreintes SHA-256 ;
- un modèle de l'escrow dont on prouve qu'il se comporte exactement comme le programme.

**Ce qui ne change pas :**
- Tout tourne dans le navigateur du visiteur.
- Pas de réseau, pas de wallet, pas de blockchain, pas de fonds réels.

**Les règles habituelles restent valables :**
- tout sur GitHub ;
- aucun déploiement de programme ;
- aucun réseau Solana public ;
- aucun service payant ;
- rien qui touche à `$MULE`.

Le travail se fait en **deux parties, dans deux dépôts, avec un arrêt entre les deux.**

## Traces GitHub

- Dans `Mule-Protocol/mule`, crée un milestone « M-1.2 · Real-logic console », avec une issue par partie.
- Chaque partie a sa branche, sa PR en brouillon et ses commits explicites, sans réécriture d'historique.
- Ne fusionne rien.

---

## PARTIE A · Dépôt `Mule-Protocol/mule` : le paquet `@mule/console-core`

### A1. Un paquet utilisable dans le navigateur

**Le paquet :** crée `packages/console-core`, sans aucune API Node (`fs`, `path`, `Buffer`, `process`…).

**Ce qu'il réutilise, sans dupliquer la logique :**
- les fixtures des trois modèles ;
- l'agent de référence (`honest` / `dishonest`) ;
- le validateur et ses messages exacts ;
- le JSON canonique.

**Si un module actuel dépend de Node :** extrais sa partie pure dans un module partagé, que le paquet Node et `console-core` importent tous les deux.

**Empreintes :** elles passent par WebCrypto (`crypto.subtle.digest('SHA-256')`).

**Ajv sans compilation à l'exécution.** Le site a une CSP stricte, sans `unsafe-eval`, et Ajv compile normalement ses schémas avec `new Function`.
- Génère les validateurs **au moment du build**, avec le mode standalone d'Ajv (`ajv/dist/standalone`).
- Le bundle final ne doit contenir ni `new Function` ni `eval`. Ajoute un test qui le vérifie.

### A2. Un modèle de l'escrow, prouvé identique au programme

**Le modèle :** écris un modèle TypeScript de la machine d'états qui couvre :
- les instructions nécessaires à la console : création, acceptation, livraison, verdict, finalisation, remboursement ;
- les soldes client, agent et vault ;
- le statut final.

**Test différentiel en CI.** Pour chacun des 6 scénarios (3 modèles × honnête/malhonnête), et pour la mission avec agent désigné, exécute les mêmes entrées dans deux environnements :
1. dans `console-core` ;
2. dans LiteSVM, avec le vrai SBF.

Puis compare, et exige l'identité exacte de :
- les statuts successifs ;
- les deltas de solde ;
- le statut final ;
- le message du validateur ;
- le `report_hash`, celui calculé par `console-core` comparé à celui enregistré on-chain.

**Test de parité Node / navigateur :** sur les mêmes entrées, le runner Node et `console-core` produisent au **même octet près** :
- les fichiers JSON canoniques ;
- leurs empreintes.

Si un écart apparaît entre le modèle et le programme, c'est le modèle qu'on corrige, jamais le programme. Signale l'écart dans le rapport.

### A3. L'interface publique

Expose une fonction qui garde l'interface de `mule-site/src/lib/run-mission.ts` :

```ts
runMission(template: 'invoice' | 'contract' | 'address', behavior: 'honest' | 'dishonest'): AsyncIterable<Step>
```

**Le type `Step` :** il garde exactement `station`, `text`, `failed` et `outcome`, avec deux champs facultatifs en plus :
- `hashes` : empreintes complètes des critères, de la livraison et du rapport ;
- `report` : le rapport du validateur, en JSON.

**Le texte des étapes :**
- Il reprend le format actuel de la console, avec les vrais messages du validateur.
- Les empreintes sont affichées en forme courte, du type `sha256:3f2a…9c1d`.
- Les transactions restent explicitement simulées : remplace `FAKE_TX_SIM_…` par `SIM-TX-…`, préfixe compris.
- N'affiche **jamais** quelque chose qui ressemble à une vraie signature Solana ou à une adresse réelle.

### A4. Le fichier publié pour le site

- Le build produit un seul module ES autonome : `packages/console-core/dist/console-core.mjs`. Il est **committé**, avec son `console-core.mjs.sha256`.
- La CI reconstruit le fichier et échoue s'il diffère du fichier committé, comme pour l'IDL.
- **Budget :** au plus 40 Ko compressé en gzip. La taille réelle figure dans le rapport.
- **Documentation :** ajoute `packages/console-core/README.md`, avec :
  - ce que le module fait et ne fait pas : pas de réseau, pas de chaîne, et un modèle prouvé par test différentiel, pas le programme lui-même ;
  - comment le reconstruire.

### Check-in A

Écris `docs/checkins/CHECKIN-5a-console-core.md` avec :
- les commits ;
- le lien du run CI vert ;
- le résultat du test différentiel, scénario par scénario ;
- le résultat de la parité Node / navigateur ;
- la taille du bundle, brute et gzip ;
- la preuve de l'absence de `eval` et de `new Function` ;
- le SHA-256 du bundle ;
- les écarts avec ces consignes.

**Puis arrête-toi.** La partie B commence seulement quand le propriétaire t'écrit « Fais la partie B », en te donnant le commit de fusion de la partie A.

---

## PARTIE B · Dépôt `Mule-Protocol/mule-site` : brancher la console

À faire uniquement après le feu vert du propriétaire.

### B1. Intégrer le module

**Mise à jour du module :**
- Ajoute `scripts/update-console-core.mjs <commit>`. Il télécharge `console-core.mjs` et son `.sha256` depuis `raw.githubusercontent.com/Mule-Protocol/mule/<commit>/…`, à ce commit exact, jamais depuis une branche.
- Il vérifie l'empreinte, puis écrit le fichier dans `src/vendor/mule-console-core/`, avec un `SOURCE.md` qui donne le commit et l'empreinte.

**Test en CI :** l'empreinte du fichier embarqué doit correspondre à `SOURCE.md`. La CI ne fait aucun appel réseau à la construction.

**Branchement :** `src/lib/run-mission.ts` devient un simple adaptateur vers le module. Ne change rien à :
- `src/data/mission.mjs` et le format des identifiants de mission ;
- les pages `/m/<id>` ;
- les images OG ;
- les Pages Functions.

### B2. Ce que le visiteur voit

**Le journal de mission :** il garde son rythme et sa présentation actuels, avec les vrais messages et les empreintes courtes.

**Le rapport d'inspection :**
- Sous le journal, ajoute un `<details>` « Inspection report ». Il affiche le rapport du validateur en JSON indenté, avec les empreintes complètes.
- Réutilise les styles existants, sans attribut `style` en ligne. Vérifie l'affichage et le défilement horizontal à 360, 375, 768 et 1440 px.

**La phrase sous la console :** ajoute exactement celle-ci, sans toucher aux autres textes :
`Runs MULE's actual validator and escrow rules in your browser. No network, no wallet, no real funds.`

**Le badge :** la mention « SIMULATION · NO REAL FUNDS » reste.

### B3. Contraintes

- La CSP reste identique : pas de `unsafe-eval`, pas de `unsafe-inline`, pas de nouveau domaine.
- Les réglages restent intacts : `LAUNCHED=false`, `CONTRACT_ADDRESS=null`, `LEGAL_PUBLISHED=false`.
- Ne touche ni au DNS, ni à Cloudflare, ni aux secrets, ni à la production.
- La performance ne doit pas baisser. Le score Lighthouse mobile de l'accueil doit rester au niveau de `main` (100/100/100/100 au dernier relevé). Charge le module seulement au premier lancement d'une mission (import dynamique), pas au chargement de la page.
- Les tests existants passent. Ajoute :
  - un test de bout en bout dans un vrai navigateur sans interface, qui lance les 6 missions et vérifie les messages exacts, puis l'absence d'erreur CSP dans la console ;
  - un test qui vérifie qu'aucune requête réseau ne part pendant une mission.

### Check-in B

**La PR :** elle part d'une branche `codex/real-logic-console`, vers `main`. Sa description contient :
- les captures avant et après, à 375 et 1440 px :
  - une mission honnête ;
  - une mission malhonnête ;
  - le rapport d'inspection ouvert ;
- les scores Lighthouse avant et après ;
- la taille ajoutée au premier lancement ;
- les écarts avec ces consignes.

**Le rapport :** range les preuves dans `docs/qa-real-logic-console/`, sans archive volumineuse.

Ne fusionne pas. Arrête-toi une fois la PR ouverte.

## Interdits

- Pas de devnet, de mainnet, de faucet, de secrets GitHub ni de service payant.
- Pas d'API d'IA.
- Rien qui touche à `$MULE`.
- Pas de modification du programme Anchor. Si tu penses qu'il en faut une, arrête-toi et explique pourquoi.
- Pas de fusion, pas de force-push, pas de changement des protections de branche.
- Ne fusionne pas les PR de Dependabot.
