# M-1.1 · Passe de renforcement

La PR #13 est fusionnée dans `main` (commit `b4ba515`). Le check-in 3 est validé, et le périmètre de `docs/spec/M1_LOCAL_ONLY_UPDATE.md` est terminé.

Cette passe durcit ce qui existe, sans nouvelle fonctionnalité. Les règles restent les mêmes : tout se fait sur GitHub, sans déploiement, sans réseau public, sans service payant, et rien ne touche à `$MULE` ni à `mule-site`.

## Traces GitHub

- Crée un milestone « M-1.1 · Hardening » avec une issue par chantier ci-dessous (5 issues).
- Travaille sur une branche créée depuis `main`, dans une PR en brouillon liée aux issues.
- Fais un commit par chantier au minimum, sans réécriture d'historique.
- Arrête-toi au check-in. Ne fusionne pas.

## 1. Fuzzing du programme (chantier principal)

Ajoute des tests par propriétés en TypeScript avec `fast-check`, qui exécutent le vrai SBF dans LiteSVM.

**Les séquences générées :** des suites aléatoires d'instructions, combinant :
- des acteurs aléatoires : client, agent, agent désigné, validateur, admin, tiers ;
- des montants et des échéances aléatoires ;
- des sauts d'horloge, y compris aux bornes exactes : fenêtre de litige, `DISPUTE_TIMEOUT`, `STALE_SECONDS` ;
- des changements de config : `pause`, rotation du validateur, transfert d'admin.

**Les invariants, vérifiés après chaque instruction :**
1. **Conservation :** client + agent + vaults = total initial, à l'unité près.
2. **Vault exact :** tant qu'une mission existe, son vault contient exactement `mission.amount`.
3. **Destinataires :** les fonds ne sortent que vers le client ou l'agent de la mission, jamais ailleurs.
4. **Un seul règlement :** une mission terminée a ses comptes fermés, et aucune instruction ne réussit dessus ensuite.
5. **États :** toute transition réussie existe dans `docs/state-machine.md`, et toute transition interdite échoue.
6. **Rôles :** le validateur en cours n'est jamais client ni agent d'une mission créée ou acceptée sous son mandat.
7. **Loyer :** le loyer revient toujours au client à la fermeture.

**Exécution :**
- **En CI, sur chaque PR :** un nombre de séquences raisonnable pour rester sous 10 minutes, avec une graine fixe affichée dans les logs.
- **Workflow planifié une fois par semaine (`schedule`) :** une campagne plus longue avec des graines aléatoires.
  - Il reste gratuit, en `contents: read` et sans secret.
  - En cas d'échec, il publie la graine et la séquence minimale réduite par `fast-check` en artefact.
- Toute séquence qui a trouvé un bug devient un test de régression permanent.

Si le fuzzing trouve un vrai défaut du programme, corrige-le dans un commit séparé et décris-le précisément dans le rapport.

## 2. Reprise après panne sans intervention manuelle

Le check-in 3 a laissé deux zones où une réconciliation manuelle peut être nécessaire :
- **(c)** entre la réservation d'un `mission_id` par le SDK et l'écriture de la transaction signée dans le journal ;
- **(d)** entre la clôture on-chain et la mise à jour du manifeste local.

**À faire :**
- Le runner réconcilie ces deux cas automatiquement, à partir de l'état on-chain :
  - existence de la PDA, dérivée du client et de l'identifiant ;
  - historique des signatures ;
  - événements terminaux.
- **Cas (c) :** un identifiant réservé sans transaction est marqué « consommé, jamais créé ». Il n'est jamais réutilisé.
- **Pour une transaction à l'issue incertaine :** le runner attend l'expiration du blockhash, puis tranche à partir de la chaîne. Il ne la renvoie jamais à l'aveugle.
- Ajoute les injections de panne `after-reserve` et `after-close`, sur le même modèle que `after-report` et `after-verdict`.
- Le job `local-missions` exécute aussi ces deux reprises sur le réseau local, et le rapport le montre.

## 3. Chaîne d'approvisionnement de la CI

- **Épinglage des actions :** chaque action GitHub est épinglée par l'empreinte complète de son commit, avec la version en commentaire, par exemple :
  `actions/checkout@<sha40> # v4.x.y`
  Vérifie chaque empreinte sur le dépôt officiel de l'action.
- **Dependabot :** il échoue actuellement sur les mises à jour npm. Trouve la cause et corrige `.github/dependabot.yml` pour que les mises à jour npm, cargo et github-actions fonctionnent toutes. Groupe les mises à jour mineures pour limiter le nombre de PR.
- **Audit des dépendances :** ajoute `cargo audit`, dans une version épinglée et vérifiée, et `pnpm audit --prod`.
  - Une vulnérabilité élevée ou critique fait échouer la CI.
  - Toute exception est listée dans un fichier documenté, avec sa raison et une date de réexamen.

## 4. Annulation d'une proposition d'admin

Ajoute l'instruction `cancel_admin_proposal`, signée par l'admin actuel, qui efface `pending_admin` et émet un événement.

**Tests :**
- l'annulation fonctionne ;
- l'acceptation après annulation est refusée ;
- un mauvais signataire est refusé ;
- l'annulation sans proposition en cours est refusée.

Mets à jour l'IDL, le SDK, la machine d'états et le modèle de menaces.

## 5. Mise à jour de la documentation

- Mets à jour le modèle de menaces avec ce que le fuzzing couvre et ne couvre pas.
- Ajoute `docs/testing/FUZZING.md`. Il explique comment relancer une graine en local en une commande.
- Mets à jour le README et la couverture par instruction (15 instructions).

## Rapport

Écris `docs/checkins/CHECKIN-4-hardening.md` avec :
- les commits ;
- le lien du run CI vert ;
- le nombre de séquences et d'instructions exécutées par le fuzzing, avec les graines ;
- les invariants vérifiés ;
- tout défaut trouvé et sa correction ;
- les preuves des reprises (c) et (d) sur le réseau local ;
- la liste des actions épinglées avec leur empreinte ;
- l'état de Dependabot ;
- le résultat des audits ;
- les écarts avec ces consignes ;
- ce que tu n'as pas pu vérifier.

Puis arrête-toi.

## Interdits

- Pas de devnet, de mainnet, de faucet, de secrets GitHub ni de service payant.
- Pas d'API d'IA.
- Rien qui touche à `$MULE` ni à `mule-site`.
- Pas de fusion, pas de force-push, pas de changement des protections de branche.
- Ne fusionne pas toi-même les PR ouvertes par Dependabot.
