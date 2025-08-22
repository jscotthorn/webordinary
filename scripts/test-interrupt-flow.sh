#!/bin/bash
# Test interrupt flow by sending multiple rapid emails to the same project/user

echo "🔄 Testing interrupt flow with rapid successive emails..."
echo ""

# Send first email
TIMESTAMP1=$(date +%s)
EMAIL_FILE1="/tmp/test-email-${TIMESTAMP1}.eml"

cat > "${EMAIL_FILE1}" << EOF
From: test@example.com
To: scott@amelia.webordinary.com
Subject: First Task ${TIMESTAMP1}
Message-ID: <test-${TIMESTAMP1}@example.com>
Date: $(date -R)
Content-Type: text/plain; charset=UTF-8

This is the FIRST email task.

Please update the homepage title to "First Task ${TIMESTAMP1}".

This should start processing normally.
EOF

echo "📧 [1/3] Uploading first email to S3..."
aws s3 cp "${EMAIL_FILE1}" s3://webordinary-ses-emails/emails/test-${TIMESTAMP1}.eml --profile personal
echo "✅ First email uploaded"

# Wait a short time for processing to start
echo "⏳ Waiting 5 seconds for first email to start processing..."
sleep 5

# Send second email (should interrupt the first)
TIMESTAMP2=$(date +%s)
EMAIL_FILE2="/tmp/test-email-${TIMESTAMP2}.eml"

cat > "${EMAIL_FILE2}" << EOF
From: test@example.com
To: scott@amelia.webordinary.com
Subject: INTERRUPT Task ${TIMESTAMP2}
Message-ID: <test-${TIMESTAMP2}@example.com>
Date: $(date -R)
Content-Type: text/plain; charset=UTF-8

This is the SECOND email - should INTERRUPT the first one!

Please update the homepage title to "Interrupted Task ${TIMESTAMP2}".

This should cause an interrupt.
EOF

echo "📧 [2/3] Uploading interrupt email to S3..."
aws s3 cp "${EMAIL_FILE2}" s3://webordinary-ses-emails/emails/test-${TIMESTAMP2}.eml --profile personal
echo "⚡ Interrupt email uploaded - should trigger interrupt flow"

# Wait a bit more
echo "⏳ Waiting 3 seconds..."
sleep 3

# Send third email (should queue after second)
TIMESTAMP3=$(date +%s)
EMAIL_FILE3="/tmp/test-email-${TIMESTAMP3}.eml"

cat > "${EMAIL_FILE3}" << EOF
From: test@example.com
To: scott@amelia.webordinary.com
Subject: Third Task ${TIMESTAMP3}
Message-ID: <test-${TIMESTAMP3}@example.com>
Date: $(date -R)
Content-Type: text/plain; charset=UTF-8

This is the THIRD email - should queue after the second.

Please update the homepage title to "Third Task ${TIMESTAMP3}".

This should be processed after the interrupt completes.
EOF

echo "📧 [3/3] Uploading third email to S3..."
aws s3 cp "${EMAIL_FILE3}" s3://webordinary-ses-emails/emails/test-${TIMESTAMP3}.eml --profile personal
echo "✅ Third email uploaded - should queue"

echo ""
echo "🔍 Checking Step Functions executions..."
aws stepfunctions list-executions \
    --state-machine-arn arn:aws:states:us-west-2:942734823970:stateMachine:email-processor \
    --max-items 5 \
    --profile personal \
    --query 'executions[*].{Name:name,Status:status,Start:startDate}' \
    --output table

echo ""
echo "📊 Checking active jobs table..."
AWS_PROFILE=personal aws dynamodb scan \
    --table-name webordinary-active-jobs \
    --query 'Items[*].{ProjectUser:projectUserId.S,ThreadId:threadId.S,Container:containerId.S}' \
    --output table

echo ""
echo "📋 To monitor container logs:"
echo "  docker logs -f claude-local-e2e"
echo ""
echo "📋 To check interrupt queue messages:"
echo "  AWS_PROFILE=personal aws sqs get-queue-attributes --queue-url https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-interrupts-amelia-scott --attribute-names ApproximateNumberOfMessages"

# Clean up
rm "${EMAIL_FILE1}" "${EMAIL_FILE2}" "${EMAIL_FILE3}" 2>/dev/null || true