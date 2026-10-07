# CHECK-IN 1 — programme et SDK, tests locaux en CI

Date : 7 octobre 2026. **Prêt pour revue indépendante. Arrêt à ce check-in ; aucune étape 3 engagée.**

## Liens et version vérifiée

- [Dépôt public](https://github.com/Mule-Protocol/mule)
- [PR en brouillon #6](https://github.com/Mule-Protocol/mule/pull/6), liée à [l'issue #1](https://github.com/Mule-Protocol/mule/issues/1)
- [Milestone M-1](https://github.com/Mule-Protocol/mule/milestone/1)
- [CI verte et artefact m1-step1-evidence](https://github.com/Mule-Protocol/mule/actions/runs/37670892851)
- Commit de code vérifié : [de9c24e625a3be1a58e47fa5c50ad07884eca4d6](https://github.com/Mule-Protocol/mule/commit/de9c24e625a3be1a58e47fa5c50ad07884eca4d6).
- Les commits suivants de ce check-in ajoutent le rapport et ses preuves, sans modifier ce code.

## Livré

- Programme Anchor : Config, Mission, vault PDA ; les 12 instructions ; événements ; contrôle des rôles, montants, délais, destinations et fermeture des comptes.
- SDK TypeScript : PDA/u64 little-endian, construction des 12 instructions depuis l'IDL générée, décodage des comptes, événements limités au programme et aux transactions réussies.
- [Machine d'états](../state-machine.md), [modèle de menaces](../threat-model.md), [architecture](../architecture.md), instructions de reproduction dans le README.
- Monorepo pnpm, Apache-2.0, dépendances verrouillées ; workflow public sans déploiement.
- [Couverture lisible](../testing/INSTRUCTION-COVERAGE.md) et [preuves machine](../testing/INSTRUCTION-COVERAGE.json), copiées de l'artefact de la CI verte.

## Résultats observés

| Vérification | Résultat |
| --- | --- |
| Compilation SBF Anchor et génération de l'IDL | Réussies |
| Formatage Rust | Conforme |
| cargo clippy --workspace --all-targets -- -D warnings | Réussi |
| Compilation SDK, vérification des types, lint | Réussis |
| Tests SDK | **7/7 réussis** |
| anchor test, SBF exécuté dans LiteSVM | **35/35 scénarios réussis** |
| Couverture par instruction | **12/12 avec assertions positives et négatives** |

Le rapport instrumenté comprend 191 appels réussis et 108 refus vérifiés, appels de préparation inclus. Des assertions supplémentaires contrôlent les doubles initialisations/créations et l'absence de signature. Ce n'est pas un pourcentage de lignes ou de branches Rust.

Les scénarios couvrent chaque transition, les sorties interdites depuis chacun des six états actifs, les mauvais signataires, destinataires/mints/PDA substitués, les doubles verdicts et finalisations, les bornes temporelles exactes, les débordements, les URI, toutes les sorties pendant une pause, les soldes, les dépôts supplémentaires au vault et la restitution du loyer.

## Périmètre et garde-fous vérifiés

La [correction du propriétaire](../spec/M1_LOCAL_ONLY_UPDATE.md) est prioritaire. Aucun déploiement, RPC public Solana, faucet, mint devnet ou workflow devnet-run. Aucun agent IA ni service payant. Les clés utilisées par les scénarios sont éphémères en mémoire ; la clé de build jetable qu'Anchor peut générer reste dans target/deploy, exclue des artefacts et caches.

Vérification GitHub du 7 octobre 2026 : dépôt public ; **0 secret Actions** ; secret scanning, push protection et mises à jour de sécurité Dependabot activés. Le fichier Dependabot des mises à jour de versions est dans la PR et attend sa fusion par le propriétaire.

main reste au bootstrap [1a9a83344f2a4cd0c170281588c36ed45065747d](https://github.com/Mule-Protocol/mule/commit/1a9a83344f2a4cd0c170281588c36ed45065747d), contenant uniquement README.md, LICENSE, .gitignore et docs/spec/. Aucune fusion ni modification des protections. Aucun changement dans mule-site.

Les issues 2, 4 et 5 ont été fermées comme non prévues après correction du périmètre ; cela ne représente pas du travail de déploiement accompli. L'issue 3 décrit désormais les 10 missions locales en CI, après revue.

## Intégrité des sources et du binaire

Les deux fichiers de référence sont conservés sans modification ; les octets originaux correspondent aussi aux blobs Git du bootstrap.

| Fichier | SHA-256 |
| --- | --- |
| SPEC_M-1_devnet_v2.md | adf08a669acb726392dd74a70a5f15b6a3230564b9a0dc21e71608f784751891 |
| PROMPT_M-1_devnet.md | da5d791db208f7beb8d9fb8b76d98e080cedc6b3857467e03e0e9741c8403a02 |
| mule_escrow.so de la CI verte ci-dessus | 6c0748d6e0366c9481603f376e13b91f2562e871fbaa8cde3c6197adfc7a404c |

Cette empreinte identifie l'artefact testé. **Ce n'est pas une attestation solana-verify** : cet outil n'a pas été exécuté à l'étape 1.

## Précisions, écarts et points de revue

- LiteSVM exécute le binaire compilé et les instructions SPL, sans déploiement. La métadonnée d'autorité ProgramData et l'horloge sont des fixtures ; le bytecode chargé est préservé.
- Les scénarios sont isolés par processus, sans retry automatique. Node 22 a provoqué un abort natif ; le passage à Node 24.21.0 puis l'isolation ont stabilisé cette suite. Le dernier échec a révélé un aller-retour décimal BN inutile dans le SDK, supprimé et couvert par un test des octets aux bornes u64/i64. La cause complète des problèmes natifs n'a pas été démontrée.
- Anchor 0.32.2 tente aussi son lecteur de logs WebSocket localhost. Le message de connexion absent concerne ce lecteur facultatif ; les tests lisent directement les logs LiteSVM. Aucun RPC public n'est utilisé.
- L'acceptation après échéance est refusée ; une URI doit contenir au moins un octet. Les additions de temps sont contrôlées.
- Les soldes supplémentaires reçus par le vault sont versés au destinataire légitime du règlement, afin de permettre sa fermeture. L'événement conserve le montant convenu.
- La fermeture prévue par la spec ne laisse pas de tombstone : un client peut réutiliser un ancien mission_id/PDA après clôture. Le SDK/runner doit conserver un historique et ne pas réutiliser les IDs. Une interdiction permanente on-chain nécessiterait une modification de la spec.
- Un litige attend la décision de l'administrateur, sans timeout autonome prévu. Les rôles de validation et d'arbitrage restent des autorités de confiance.
- Les événements de configuration ConfigInitialized/ConfigUpdated complètent les événements de mission, sans mission fictive associée.

## Non exécuté et suite

Pas de réseau public, audit indépendant, déploiement Squads, vérification d'upgrade réelle ou build solana-verify. Pas encore de validateur Ajv, agent scripté, stockage adressé par hash, runner ni campagne des 10 missions : ces éléments appartiennent à l'étape 3, après revue.

Points pour la revue : accepter explicitement les limites de réutilisation des IDs et de liveness des litiges ; décider où replacer l'éventuelle preuve de build solana-verify dans le périmètre sans déploiement. Aucune modification de protocole supplémentaire n'a été introduite pour résoudre ces points.

**Seul le propriétaire fusionne. Le travail s'arrête ici en attente de la revue indépendante et d'une consigne de reprise.**
