# tado-sync

Synchronise automatiquement les index de compteur gaz relevés par **GRDF** (Gazpar) vers les
relevés de compteur **Tado Energy IQ**, via une tâche planifiée tournant dans un conteneur Docker.

## Fonctionnement

À chaque exécution (par défaut tous les jours à 10h, heure de Paris) :

1. connexion à l'espace client [monespace.grdf.fr](https://monespace.grdf.fr) et récupération des
   relevés journaliers informatifs des `LOOKBACK_DAYS` derniers jours ;
2. lecture des relevés déjà présents dans Tado Energy IQ ;
3. envoi à Tado de chaque index GRDF (en m³, arrondi à l'entier) postérieur au dernier relevé connu
   de Tado. Une synchronisation relancée n'envoie donc jamais de doublon.

GRDF publie généralement les données de la veille dans la matinée, d'où l'horaire par défaut.

## Démarrage rapide

```bash
cp .env.example .env   # puis renseignez vos identifiants GRDF
mkdir -p data && sudo chown 1000:1000 data
docker compose up -d
docker compose logs -f
```

Au premier lancement, aucun token Tado n'existe : un lien `https://login.tado.com/...` s'affiche
dans les logs. Ouvrez-le et validez l'accès avec votre compte Tado (le lien expire après quelques
minutes, un nouveau est alors généré). Le refresh token est ensuite conservé dans
`/data/tado-token.json` ; ce volume doit donc être persistant.

Pour lancer une synchronisation unique :

```bash
docker run --rm --env-file .env -v ./data:/data ghcr.io/pierrickrouxel/tado-sync --once
```

L'option `--auth` permet de seulement effectuer l'autorisation Tado puis de quitter.

## Configuration

| Variable             | Obligatoire | Défaut                  | Description                                                         |
| -------------------- | ----------- | ----------------------- | ------------------------------------------------------------------- |
| `GRDF_USERNAME`      | oui         |                         | E-mail de l'espace client GRDF                                      |
| `GRDF_PASSWORD`      | oui         |                         | Mot de passe GRDF (la double authentification doit être désactivée) |
| `GRDF_PCE`           | non         | premier PCE du compte   | Numéro de point de comptage                                         |
| `TADO_HOME_ID`       | non         | premier logement        | Identifiant du logement Tado                                        |
| `TADO_REFRESH_TOKEN` | non         |                         | Refresh token Tado initial, si vous en avez déjà un                 |
| `TADO_TOKEN_FILE`    | non         | `/data/tado-token.json` | Fichier de stockage du refresh token Tado                           |
| `CRON`               | non         | `0 10 * * *`            | Planification au format cron                                        |
| `TZ`                 | non         | `Europe/Paris`          | Fuseau horaire de la planification                                  |
| `LOOKBACK_DAYS`      | non         | `30`                    | Nombre de jours d'historique GRDF relus                             |
| `RUN_ON_START`       | non         | `true`                  | Lancer une synchronisation au démarrage                             |
| `DRY_RUN`            | non         | `false`                 | Afficher les relevés sans les envoyer à Tado                        |
| `LOG_LEVEL`          | non         | `info`                  | `debug`, `info`, `warn` ou `error`                                  |

## API utilisées

- **GRDF** : l'API de l'espace client particulier (`monespace.grdf.fr/api/e-conso`), la même que
  celle utilisée par [PyGazpar](https://github.com/ssenart/PyGazpar). L'API officielle ADICT de
  GRDF est réservée aux entreprises partenaires.
- **Tado** : authentification OAuth2 *device code flow* (`login.tado.com`) et API Energy IQ
  (`energy-insights.tado.com/api/homes/{id}/meterReadings`).

Ces API ne sont pas documentées publiquement et peuvent évoluer sans préavis.

## Développement

```bash
npm ci
npm test
npm run build
GRDF_USERNAME=... GRDF_PASSWORD=... DRY_RUN=true npm run sync
```

## Versionnement et publication

Les messages de commit suivent les [Conventional Commits](https://www.conventionalcommits.org/fr/).
À chaque push sur `main`, GitHub Actions exécute les tests puis
[semantic-release](https://semantic-release.gitbook.io/) calcule la version, crée le tag et la
release GitHub, et l'image Docker multi-architecture (`amd64`, `arm64`) est publiée sur
`ghcr.io/pierrickrouxel/tado-sync` avec les tags `X.Y.Z`, `X.Y`, `X` et `latest`.
