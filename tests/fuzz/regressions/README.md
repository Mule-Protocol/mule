# Régressions de fuzzing

Le pilote rejoue tous les fichiers `.json` avant les séquences générées et compte les régressions séparément des dix exemples fixes. Une régression du harnais ne prouve pas un défaut du programme.

## `decimal-bn-observation-37688283162.json`

Source : [run CI 37688283162](https://github.com/Mule-Protocol/mule/actions/runs/37688283162), commit `874bc2e`, graine `20261007`, artefact `m11-fuzz-evidence`, `failure-000047.json` (premier échec, évaluation 47). Les 66 commandes sont conservées intégralement, sans modification. Le job a atteint son délai de huit minutes pendant la réduction ; cette séquence est un contre-exemple **provisoire, non minimal** et aucun chemin final fast-check n'était disponible.

L'assertion `BigInt(decoded.amount.toString()) === model.amount` lisait `7816772` au lieu de `97816772`. Le contrôle exact du vault SPL venait de réussir. Un candidat réduit ultérieur lisait `7108864` au lieu de `67108864`. Le stockage Rust et le transfert SPL emploient le même argument `amount`. Cette observation ne démontre ni une faille SBF ni une cause JIT particulière.

Le harnais compare désormais les BN via leurs huit octets et les lecteurs natifs u64/i64, sans texte décimal. Des tests de codec et de persistance des preuves couvrent ces deux montants et les limites u64/i64. La séquence complète reste rejouée sur SBF pour vérifier la correction du harnais et révéler toute divergence restante.

Toute découverte confirmée dans le programme doit ajouter sa séquence réduite avec sa source et être corrigée dans un commit de programme séparé.
