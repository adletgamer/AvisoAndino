#!/usr/bin/env bash
# Prueba de uso del AWS MCP Server (ver docs/SUBMISSION.md §3). Enmascara el account ID en la salida.
set -euo pipefail
REGION="${AWS_REGION:-us-east-1}"; DAYS="${1:-3}"
START="$(date -u -d "-${DAYS} days" +%Y-%m-%dT%H:%M:%SZ)"
mkdir -p docs/proof
aws cloudtrail lookup-events --region "$REGION" --start-time "$START" --max-results 50 \
  --query "Events[?contains(CloudTrailEvent, 'aws-mcp')].CloudTrailEvent" --output json \
  | sed -E 's/\b([0-9]{4})[0-9]{8}\b/\1XXXXXXXX/g' > docs/proof/cloudtrail-mcp-management.json
echo "Guardado docs/proof/cloudtrail-mcp-management.json ($(jq length docs/proof/cloudtrail-mcp-management.json) eventos)"
# TODO: data events (CallTool) desde el bucket del trail -> docs/proof/cloudtrail-mcp-data.json
