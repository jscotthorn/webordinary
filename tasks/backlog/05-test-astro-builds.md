# Task 05: Test Astro Build and Deployment Patterns

## Objective
Thoroughly test various Astro build scenarios and S3 deployment patterns to understand performance characteristics and potential issues before containerization.

## Context
We need to understand how Astro builds behave and how S3 sync performs under different conditions to properly design the container workflow.

## Prerequisites
- Tasks 01-03 completed
- Local Astro project set up
- S3 bucket accessible
- Multiple test scenarios prepared

## Test Scenarios

### 1. Baseline Performance Metrics
Establish baseline timings for container implementation:

```bash
# Clean build timing
rm -rf node_modules dist
time npm ci
time npm run build
du -sh dist/  # Size of built files

# Count files
find dist -type f | wc -l

# Initial sync timing
time aws s3 sync ./dist s3://edit.amelia.webordinary.com --delete
```

Record:
- [ ] npm ci time: _____
- [ ] npm run build time: _____
- [ ] dist folder size: _____
- [ ] Number of files: _____
- [ ] Initial sync time: _____

### 2. Incremental Build Testing

#### Test 2.1: Single File Change
```bash
# Modify one component
echo "<!-- Test change -->" >> src/components/Header.astro
time npm run build
time aws s3 sync ./dist s3://edit.amelia.webordinary.com --delete
```

#### Test 2.2: Multiple File Changes
```bash
# Modify several files
# Edit 5-10 files across the project
time npm run build
time aws s3 sync ./dist s3://edit.amelia.webordinary.com --delete
```

#### Test 2.3: Asset Changes
```bash
# Add/modify images or CSS
# Add a new image to public/
time npm run build
time aws s3 sync ./dist s3://edit.amelia.webordinary.com --delete
```

### 3. Branch Switching Scenarios
Simulate git branch switches that container will perform:

```bash
# Create test branches
git checkout -b test-session-1
# Make changes
echo "Session 1 changes" >> src/pages/index.astro
npm run build
aws s3 sync ./dist s3://edit.amelia.webordinary.com --delete

# Switch branches
git checkout -b test-session-2
# Different changes
echo "Session 2 changes" >> src/pages/about.astro
npm run build
time aws s3 sync ./dist s3://edit.amelia.webordinary.com --delete

# Note how dist folder changes between branches
```

### 4. Error Handling Scenarios

#### Test 4.1: Build Failures
```bash
# Introduce syntax error
echo "{{{{" >> src/pages/index.astro
npm run build  # Should fail
# Document error output format
```

#### Test 4.2: Partial Sync Failures
```bash
# Test with incorrect permissions
AWS_PROFILE=wrong_profile aws s3 sync ./dist s3://edit.amelia.webordinary.com
# Document error handling needs
```

#### Test 4.3: Large File Handling
```bash
# Add a large file (video, etc.)
cp large-file.mp4 public/
npm run build
time aws s3 sync ./dist s3://edit.amelia.webordinary.com --delete
# Note performance impact
```

### 5. S3 Sync Optimization Testing

#### Test 5.1: Parallel Uploads
```bash
# Test with different CLI options
aws configure set default.s3.max_concurrent_requests 20
aws configure set default.s3.max_bandwidth 100MB/s
time aws s3 sync ./dist s3://edit.amelia.webordinary.com --delete
```

#### Test 5.2: Exclude Patterns
```bash
# Test excluding certain files
aws s3 sync ./dist s3://edit.amelia.webordinary.com \
  --delete \
  --exclude "*.map" \
  --exclude ".DS_Store"
```

#### Test 5.3: Cache Headers
```bash
# Test different cache strategies
# For assets (long cache)
aws s3 sync ./dist/_astro s3://edit.amelia.webordinary.com/_astro \
  --cache-control "max-age=31536000"

# For HTML (no cache)
aws s3 sync ./dist s3://edit.amelia.webordinary.com \
  --exclude "*" \
  --include "*.html" \
  --cache-control "no-cache"
```

### 6. Concurrent Session Simulation
Simulate multiple sessions modifying the same project:

```bash
# Terminal 1: Session A
git checkout session-a
# Make changes
npm run build
aws s3 sync ./dist s3://edit.amelia.webordinary.com --delete

# Terminal 2: Session B (interrupt)
git checkout session-b
# Different changes
npm run build
aws s3 sync ./dist s3://edit.amelia.webordinary.com --delete

# Test rapid switching
```

## Performance Analysis

### Metrics to Collect
1. **Build Performance**
   - Cold build time (no cache)
   - Warm build time (with cache)
   - Incremental build time
   - Memory usage during build

2. **Sync Performance**
   - Full sync time
   - Incremental sync time
   - Network bandwidth usage
   - S3 API call count

3. **Storage Patterns**
   - Total storage used
   - File count growth
   - Cleanup effectiveness of --delete

### Create Performance Matrix
| Scenario | Build Time | Sync Time | Total Time | Files Changed |
|----------|------------|-----------|------------|---------------|
| Cold start | | | | |
| Single file | | | | |
| Multi file | | | | |
| Branch switch | | | | |
| Large asset | | | | |

## Container Considerations
Document findings relevant to container implementation:

1. **Memory Requirements**
   - Minimum RAM needed for build: _____
   - Recommended container memory: _____

2. **Disk Space**
   - Space for node_modules: _____
   - Space for dist: _____
   - Working space needed: _____

3. **Network Optimizations**
   - Optimal S3 sync settings: _____
   - Bandwidth requirements: _____

4. **Error Recovery**
   - Build failure handling strategy
   - Partial sync recovery approach
   - Cleanup procedures needed

## Acceptance Criteria
- [ ] All test scenarios executed
- [ ] Performance metrics documented
- [ ] Error scenarios understood
- [ ] Optimization strategies identified
- [ ] Container requirements defined
- [ ] Results documented in /docs/ASTRO_S3_TEST_RESULTS.md

## Output Document
Create `/docs/ASTRO_S3_TEST_RESULTS.md` with:
- Test execution dates
- Performance metrics table
- Optimization recommendations
- Container sizing recommendations
- Known issues and workarounds

## Time Estimate
4-5 hours for comprehensive testing

## Notes
- Run tests multiple times for consistency
- Test during different network conditions
- Document any Astro-specific quirks
- Save test scripts for future use