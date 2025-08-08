## Important things
* Refer to source documentation for integrating with libraries and services.

## Development Commands

### Hephaestus (CDK Project) (`/hephaestus/`)
AWS CDK-based infrastructure as code.

```bash
npm run build          # Compile TypeScript
npm run test           # Run Jest unit tests
npm run cdk            # Run CDK CLI commands
npx cdk deploy         # Deploy infrastructure to AWS
npx cdk diff          # Compare deployed stack with current state
npx cdk synth         # Generate CloudFormation template
```

### Hermes (NestJS Application) (`/hermes/`)
NestJS-based backend service.
```bash
npm run build          # Build the application
npm run start          # Start in production mode
npm run test           # Run unit tests
npm run test:cov       # Run tests with coverage
npm run test:e2e       # Run end-to-end tests
npm run lint           # Run ESLint with auto-fix
npm run format         # Format code with Prettier
```