# Task 03: Test Local S3 Sync from Development Machine

## Objective
Verify that we can build an Astro site locally and sync it to S3, confirming the deployment pipeline works before containerizing it.

## Context
Before modifying the container, we need to prove the S3 sync workflow works from a local development environment with a real Astro project.

## Prerequisites
- Task 01 & 02 completed (S3 bucket and Route53 configured)
- AWS CLI installed and configured locally
- Access to Astro project repository
- Node.js and npm installed

## Requirements

### Local Environment Setup
1. **Clone Astro Project**
   ```bash
   # Clone the actual project we'll be editing
   git clone [astro-project-repo]
   cd astro-project
   
   # Or use existing local copy
   cd /workspace/amelia/stamps
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Configure AWS CLI**
   ```bash
   # Ensure AWS profile is set
   export AWS_PROFILE=personal
   
   # Verify access to S3
   aws s3 ls s3://edit.amelia.webordinary.com/
   ```

### Build and Deploy Process
1. **Build Astro Site**
   ```bash
   # Build for production
   npm run build
   
   # Verify dist folder created
   ls -la dist/
   ```

2. **Initial S3 Sync**
   ```bash
   # Dry run first to see what will be uploaded
   aws s3 sync ./dist s3://edit.amelia.webordinary.com --delete --dryrun
   
   # Actual sync
   aws s3 sync ./dist s3://edit.amelia.webordinary.com --delete
   ```

3. **Verify Deployment**
   - Open http://edit.amelia.webordinary.com in browser
   - Should see the Astro site (not test page)
   - Check browser console for any asset loading errors

### Test Update Workflow
1. **Make a Visible Change**
   ```bash
   # Edit something obvious (like homepage title)
   # Use your preferred editor
   ```

2. **Rebuild and Redeploy**
   ```bash
   npm run build
   aws s3 sync ./dist s3://edit.amelia.webordinary.com --delete
   ```

3. **Verify Update**
   - Refresh browser (Cmd+Shift+R for hard refresh)
   - Change should be visible immediately
   - No CloudFront invalidation needed

## Acceptance Criteria
- [ ] Astro project builds successfully locally
- [ ] AWS CLI can access S3 bucket
- [ ] Initial sync uploads all files
- [ ] Site accessible at http://edit.amelia.webordinary.com
- [ ] All assets load correctly (CSS, JS, images)
- [ ] Updates are visible immediately after sync
- [ ] --delete flag removes old files properly

## Testing Scenarios

### 1. Full Deploy Test
```bash
# Clean build and deploy
rm -rf dist/
npm run build
time aws s3 sync ./dist s3://edit.amelia.webordinary.com --delete
# Note the time taken for full sync
```

### 2. Incremental Update Test
```bash
# Change one file
echo "<!-- Updated $(date) -->" >> src/pages/index.astro
npm run build
time aws s3 sync ./dist s3://edit.amelia.webordinary.com --delete
# Should be faster (only changed files)
```

### 3. Asset Loading Test
- Check Network tab in browser DevTools
- All requests should return 200
- No CORS errors
- No mixed content warnings

## Document Results
Record the following for container implementation:
- Build time for Astro project
- Sync time for full deployment
- Sync time for incremental updates
- Total size of dist folder
- Number of files uploaded
- Any special flags needed for sync

## Common Issues & Solutions

### Issue: Access Denied
```bash
# Check AWS credentials
aws sts get-caller-identity

# Ensure correct profile
export AWS_PROFILE=personal
```

### Issue: Sync Not Updating
```bash
# Force update with cache-control
aws s3 sync ./dist s3://edit.amelia.webordinary.com \
  --delete \
  --cache-control "no-cache"
```

### Issue: CORS Errors
- Check S3 CORS configuration
- Ensure all asset domains are allowed

## Notes
- This proves the concept before container work
- Document exact commands that work
- Save successful command sequence for container implementation
- Note any project-specific build requirements

## Time Estimate
2-3 hours including multiple test scenarios