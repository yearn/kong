# 1Password secret template for the Render ingest deploy.
# Each line maps a Render env-var name -> a 1Password secret reference.
# load-secrets-action resolves these; the deploy workflow then pushes each one
# into the Render env group `kong`. This file is the single source of truth for
# which secrets get synced. Add/remove lines to match the 1Password `kong` item.
#
# NOT listed on purpose:
#   REDIS_HOST / REDIS_PORT / NODE_VERSION  -> set fromService in render.yaml
#
# RPC endpoints (chains 1, 10, 137, 250, 8453, 42161)
HTTP_ARCHIVE_1=op://webops-prod/kong/HTTP_ARCHIVE_1
HTTP_ARCHIVE_10=op://webops-prod/kong/HTTP_ARCHIVE_10
HTTP_ARCHIVE_137=op://webops-prod/kong/HTTP_ARCHIVE_137
HTTP_ARCHIVE_250=op://webops-prod/kong/HTTP_ARCHIVE_250
HTTP_ARCHIVE_8453=op://webops-prod/kong/HTTP_ARCHIVE_8453
HTTP_ARCHIVE_42161=op://webops-prod/kong/HTTP_ARCHIVE_42161
HTTP_FULLNODE_1=op://webops-prod/kong/HTTP_FULLNODE_1
HTTP_FULLNODE_10=op://webops-prod/kong/HTTP_FULLNODE_10
HTTP_FULLNODE_137=op://webops-prod/kong/HTTP_FULLNODE_137
HTTP_FULLNODE_250=op://webops-prod/kong/HTTP_FULLNODE_250
HTTP_FULLNODE_8453=op://webops-prod/kong/HTTP_FULLNODE_8453
HTTP_FULLNODE_42161=op://webops-prod/kong/HTTP_FULLNODE_42161

# Postgres
POSTGRES_HOST=op://webops-prod/kong/POSTGRES_HOST
POSTGRES_DATABASE=op://webops-prod/kong/POSTGRES_DATABASE
POSTGRES_USER=op://webops-prod/kong/POSTGRES_USER
POSTGRES_PASSWORD=op://webops-prod/kong/POSTGRES_PASSWORD
POSTGRES_PORT=op://webops-prod/kong/POSTGRES_PORT
POSTGRES_SSL=op://webops-prod/kong/POSTGRES_SSL

# Prices / yDaemon / yPrice
YDAEMON_API=op://webops-prod/kong/YDAEMON_API
YPRICE_ENABLED=op://webops-prod/kong/YPRICE_ENABLED
YPRICE_API=op://webops-prod/kong/YPRICE_API
YPRICE_API_X_SIGNER=op://webops-prod/kong/YPRICE_API_X_SIGNER
YPRICE_API_X_SIGNATURE=op://webops-prod/kong/YPRICE_API_X_SIGNATURE
PRICE_SERVICE_API_KEY=op://webops-prod/kong/PRICE_SERVICE_API_KEY
PRICE_SERVICE_URL=op://webops-prod/kong/PRICE_SERVICE_URL

# Webhook auth
WEBHOOK_SECRET_S_SUBSCRIPTIONID=op://webops-prod/kong/WEBHOOK_SECRET_S_SUBSCRIPTIONID
WEBHOOK_SECRET_S_YVUSD_APR=op://webops-prod/kong/WEBHOOK_SECRET_S_YVUSD_APR
WEBHOOK_SECRET_S_KATANA_APR=op://webops-prod/kong/WEBHOOK_SECRET_S_KATANA_APR

# Optional config / extras the ingest worker can read. Uncomment the ones that
# actually exist as fields in the 1Password `kong` item (an unresolved ref fails
# the whole job).
# MONITOR_API_KEY=op://webops-prod/kong/MONITOR_API_KEY
# SENTRY_DSN=op://webops-prod/kong/SENTRY_DSN
# RISK_CDN_URL=op://webops-prod/kong/RISK_CDN_URL
# REST_CACHE_REDIS_URL=op://webops-prod/kong/REST_CACHE_REDIS_URL
# GQL_CACHE_REDIS_URL=op://webops-prod/kong/GQL_CACHE_REDIS_URL
# APE_TAX_VAULTS=op://webops-prod/kong/APE_TAX_VAULTS
# DEFAULT_START_DAYS_AGO=op://webops-prod/kong/DEFAULT_START_DAYS_AGO
# FULL_NODE_DEPTH=op://webops-prod/kong/FULL_NODE_DEPTH
# LOG_STRIDE=op://webops-prod/kong/LOG_STRIDE
