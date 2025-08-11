# Task 01: Create S3 Bucket for edit.amelia.webordinary.com

## Objective
Create and configure an S3 bucket for static website hosting that will serve the Astro-built site for the edit environment.

## Context
We're moving from container-based web serving to direct S3 static hosting to eliminate complexity and reduce costs. The bucket name must match the URL exactly for Route53 alias records to work.

## Requirements

### S3 Bucket Setup
1. **Create bucket via AWS Console**
   - Bucket name: `edit.amelia.webordinary.com`
   - Region: `us-west-2`
   - Note: Name must match URL exactly

2. **Enable Static Website Hosting**
   - Index document: `index.html`
   - Error document: `404.html`
   - Note the website endpoint URL for Route53 setup

3. **Configure Public Access**
   - Unblock all public access (needed for website hosting)
   - Acknowledge that bucket will be public

4. **Add Bucket Policy**
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "PublicReadGetObject",
         "Effect": "Allow",
         "Principal": "*",
         "Action": "s3:GetObject",
         "Resource": "arn:aws:s3:::edit.amelia.webordinary.com/*"
       }
     ]
   }
   ```

5. **Configure CORS** (for Astro assets)
   ```json
   [
     {
       "AllowedHeaders": ["*"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedOrigins": ["*"],
       "ExposeHeaders": [],
       "MaxAgeSeconds": 3000
     }
   ]
   ```

## Acceptance Criteria
- [ ] Bucket created with exact name `edit.amelia.webordinary.com`
- [ ] Static website hosting enabled
- [ ] Public access allowed
- [ ] Bucket policy applied for public read
- [ ] CORS configured for asset loading
- [ ] Website endpoint URL documented
- [ ] Test file uploaded and accessible via browser

## Testing
1. Upload a test `index.html` file:
   ```html
   <!DOCTYPE html>
   <html>
   <head><title>Edit Environment Test</title></head>
   <body><h1>S3 Static Hosting Works!</h1></body>
   </html>
   ```

2. Verify accessible at S3 website endpoint:
   - `http://edit.amelia.webordinary.com.s3-website-us-west-2.amazonaws.com/`

## Notes
- Keep AWS Console screenshots for documentation
- Record the S3 website endpoint URL for Route53 configuration
- This is manual setup for PoC - will automate with CDK later
- Production bucket `amelia.webordinary.com` already exists - don't modify

## Time Estimate
2-3 hours including testing and documentation