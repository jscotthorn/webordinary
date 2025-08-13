# Documentation Inventory & Audit

## Component Documentation Status

### 1. claude-code-container
**Files**: README.md, CLAUDE.md  
**Status**: Mixed (contains both old and new patterns)

**Issues Found**:
- ✅ Correctly describes S3 deployment architecture
- ✅ No longer mentions port 8080 web serving
- ⚠️ Still has references to "session" instead of "project+user" claiming
- ⚠️ Tests section may reference old HTTP endpoints
- ✅ Message schemas look current

**Action Required**:
- Update claiming terminology
- Verify test documentation matches reality

### 2. hermes
**Files**: README.md, CLAUDE.md  
**Status**: Mostly Current

**Issues Found**:
- ✅ Describes queue-based architecture correctly
- ✅ Mentions container management
- ⚠️ API endpoints section shows HTTP endpoints - verify if these are internal only
- ⚠️ May need clearer explanation of unclaimed queue pattern
- ✅ Cost optimization section is accurate

**Action Required**:
- Clarify which HTTP endpoints are health-only
- Better document unclaimed queue workflow

### 3. hephaestus
**Files**: README.md, CLAUDE.md  
**Status**: Contains Legacy References

**Issues Found**:
- ⚠️ ALB routing rules still show web traffic patterns
- ⚠️ References to port 8080 and WebSocket routing
- ⚠️ "Upcoming Infrastructure Changes" sections outdated
- ✅ Stack descriptions are accurate
- ✅ Deploy commands are correct

**Action Required**:
- Remove ALB web routing documentation
- Update to reflect S3-only architecture
- Clean up future plans sections

### 4. tests/integration
**Files**: README.md  
**Status**: Outdated

**Issues Found**:
- ⚠️ "ALB Routing" test scenario needs removal
- ⚠️ References to container web serving
- ⚠️ May test old HTTP endpoints
- ✅ Infrastructure validation looks good
- ✅ AWS service clients seem appropriate

**Action Required**:
- Remove ALB routing tests
- Add S3 deployment tests
- Update scenarios for queue-based flow

### 5. Root Level
**Files**: README.md, CLAUDE.md  
**Status**: Current (Sprint 6/7 focused)

**Issues Found**:
- ✅ Correctly describes S3 architecture
- ✅ No web server mentions
- ✅ Quick commands are accurate
- ✅ Sprint references are current

**Action Required**:
- None, this is authoritative

### 6. docs/
**Files**: LOCAL_DEVELOPMENT.md  
**Status**: Needs Review

**Issues Found**:
- Unknown if Docker Compose reflects current architecture
- May have port mappings that shouldn't exist

**Action Required**:
- Review Docker Compose configuration
- Ensure no port 8080 mappings

## Code Files with Potential Issues

### High Priority (Core Logic)
1. **claude-code-container/src/**
   - Check for Express server code
   - Look for port 8080 references
   - Verify health check implementation

2. **hermes/src/**
   - Check session vs project+user terminology
   - Verify unclaimed queue handling
   - Look for HTTP routing code

3. **hephaestus/lib/**
   - ALB configuration with web routes
   - Target group health checks
   - Port configurations

### Medium Priority (Tests)
1. **claude-code-container/tests/**
   - Remove web server tests
   - Update integration tests

2. **hermes/test/**
   - Verify queue message handling
   - Check claim patterns

3. **tests/integration/scenarios/**
   - Remove ALB routing tests
   - Add S3 verification

### Low Priority (Scripts/Config)
1. **scripts/**
   - Build scripts may have old assumptions
   - Deployment scripts might reference ports

2. **docker-compose files**
   - Check for port mappings
   - Verify environment variables

## Legacy Patterns Found

### Pattern 1: HTTP Web Serving
**Locations**:
- hephaestus ALB rules documentation
- Integration test scenarios
- Possibly in Docker configs

### Pattern 2: Session-per-Container
**Locations**:
- Some documentation refers to sessions owning containers
- Should be project+user ownership

### Pattern 3: WebSocket HMR
**Locations**:
- hephaestus routing rules
- ALB configuration
- Some test scenarios

### Pattern 4: Port 8080 References
**Locations**:
- Infrastructure documentation
- Possibly in code
- Docker configurations

## Recommended Audit Order

1. **Day 1**: Code audit
   - Scan for port 8080
   - Find Express server code
   - Look for WebSocket handlers

2. **Day 2**: Test audit
   - Identify failing tests
   - Find HTTP endpoint tests
   - Look for ALB routing tests

3. **Day 3**: Documentation update
   - Update based on code reality
   - Remove legacy examples
   - Add current patterns

## Search Commands for Audit

```bash
# Find port 8080 references
grep -r "8080" --include="*.ts" --include="*.js" --include="*.md" --exclude-dir=node_modules .

# Find Express server references
grep -r "express\|app.listen" --include="*.ts" --include="*.js" --exclude-dir=node_modules .

# Find WebSocket references
grep -r "websocket\|ws:" --include="*.ts" --include="*.js" --include="*.md" --exclude-dir=node_modules .

# Find session-per-container patterns
grep -r "session.*container\|container.*session" --include="*.md" --include="*.ts" --exclude-dir=node_modules .

# Find ALB routing patterns
grep -r "ALB.*routing\|path.*routing" --include="*.md" --include="*.ts" --exclude-dir=node_modules .
```

## Next Steps

1. Run the search commands above
2. Create specific issue files for each problem found
3. Build component-specific checklists
4. Execute fixes in priority order