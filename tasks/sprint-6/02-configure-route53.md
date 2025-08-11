# Task 02: Configure Route53 DNS for edit.amelia.webordinary.com

## Objective
Set up Route53 to point edit.amelia.webordinary.com to the S3 static website endpoint.

## Context
After creating the S3 bucket with static website hosting, we need to configure DNS so the custom domain points to the S3-hosted site.

## Prerequisites
- Task 01 completed (S3 bucket created and configured)
- S3 website endpoint URL available
- Access to Route53 in AWS Console
- webordinary.com hosted zone exists

## Requirements

### Route53 Configuration
1. **Navigate to Route53 Console**
   - Find the `webordinary.com` hosted zone
   - Note the existing records (don't modify production records)

2. **Create A Record for edit.amelia.webordinary.com**
   - Record name: `edit.amelia`
   - Record type: `A - IPv4 address`
   - Alias: `Yes`
   - Alias target: S3 website endpoint
     - Region: `us-west-2`
     - Select the S3 bucket from dropdown
     - Should show: `edit.amelia.webordinary.com.s3-website-us-west-2.amazonaws.com`
   - Routing policy: `Simple routing`
   - Evaluate target health: `No`

3. **Verify DNS Propagation**
   - Wait 5-10 minutes for DNS to propagate
   - Use `nslookup` or `dig` to verify:
   ```bash
   nslookup edit.amelia.webordinary.com
   dig edit.amelia.webordinary.com
   ```

## Acceptance Criteria
- [ ] A record created for edit.amelia.webordinary.com
- [ ] Record configured as alias to S3 website endpoint
- [ ] DNS resolution working (nslookup returns S3 IPs)
- [ ] Test page accessible at https://edit.amelia.webordinary.com
- [ ] No impact to existing production domains

## Testing
1. **DNS Resolution Test**
   ```bash
   # Should resolve to S3 IPs
   nslookup edit.amelia.webordinary.com
   
   # Should show ALIAS record
   dig edit.amelia.webordinary.com
   ```

2. **Browser Test**
   - Navigate to http://edit.amelia.webordinary.com
   - Should see the test HTML page from Task 01
   - Note: HTTPS won't work without CloudFront (OK for PoC)

3. **Curl Test**
   ```bash
   curl -I http://edit.amelia.webordinary.com
   # Should return 200 OK with S3 headers
   ```

## Rollback Plan
If issues arise:
1. Delete the A record in Route53
2. DNS will stop resolving (safe failure)
3. S3 bucket remains accessible via direct endpoint

## Notes
- HTTP only for now (S3 doesn't support HTTPS directly)
- Would need CloudFront for HTTPS (skipping for PoC)
- Record the exact alias target for documentation
- Take screenshots of Route53 configuration

## Time Estimate
1-2 hours including DNS propagation wait time