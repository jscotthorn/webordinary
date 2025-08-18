#!/bin/bash
# Test email directly to AWS S3 to trigger Step Functions

TIMESTAMP=$(date +%s)
EMAIL_FILE="/tmp/test-email-${TIMESTAMP}.eml"

# Create test email
cat > "${EMAIL_FILE}" << EOF
From: test@example.com
To: scott@amelia.webordinary.com
Subject: Test Unclaimed Queue ${TIMESTAMP}
Message-ID: <test-${TIMESTAMP}@example.com>
Date: $(date -R)
Content-Type: text/plain; charset=UTF-8

This is a test email for the unclaimed queue pattern.

Please update the homepage title to "Test ${TIMESTAMP}".

Thanks!
EOF

echo "📧 Uploading test email to S3..."
aws s3 cp "${EMAIL_FILE}" s3://webordinary-ses-emails/emails/test-${TIMESTAMP}.eml --profile personal

echo "✅ Email uploaded: s3://webordinary-ses-emails/emails/test-${TIMESTAMP}.eml"
echo ""
echo "Waiting for S3 event to trigger Lambda..."
sleep 2

# Check for Step Functions execution
echo "Checking Step Functions executions..."
aws stepfunctions list-executions \
    --state-machine-arn arn:aws:states:us-west-2:942734823970:stateMachine:email-processor \
    --max-items 3 \
    --profile personal \
    --query 'executions[*].{Name:name,Status:status,Start:startDate}' \
    --output table

# Clean up
rm "${EMAIL_FILE}"

echo ""
echo "Monitor container logs in the other terminal to see if it receives the claim request."