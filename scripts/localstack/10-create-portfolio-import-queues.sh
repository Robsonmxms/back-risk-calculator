#!/bin/sh
set -eu

awslocal sqs create-queue \
  --queue-name portfolio-imports-dlq.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=false

dlq_arn="$(awslocal sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/portfolio-imports-dlq.fifo \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text)"

attributes_file="$(mktemp)"
trap 'rm -f "$attributes_file"' EXIT
printf '{"FifoQueue":"true","ContentBasedDeduplication":"false","VisibilityTimeout":"120","RedrivePolicy":"{\\"deadLetterTargetArn\\":\\"%s\\",\\"maxReceiveCount\\":\\"3\\"}"}\n' \
  "$dlq_arn" >"$attributes_file"

awslocal sqs create-queue \
  --queue-name portfolio-imports.fifo \
  --attributes "file://${attributes_file}"
