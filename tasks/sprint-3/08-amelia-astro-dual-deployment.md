# Task 15: Amelia-Astro Dual Deployment Strategy

## Overview
Configure the `amelia-astro` codebase to serve dual purposes: as the WebOrdinary marketing site (webordinary.com) and as the base template for client editor environments.

## Background
- `amelia-astro` contains the core Astro site structure
- Need to deploy same codebase for webordinary.com marketing
- Must serve as template for new client sites in editor
- Should demonstrate the platform's capabilities

## Requirements

### Dual-Purpose Architecture
1. **WebOrdinary.com Deployment**
   - Deploy as static marketing/portfolio site
   - Showcase platform capabilities
   - Include documentation and pricing
   - Demo of editing capabilities

2. **Editor Template System**
   - Base template for new client sites
   - Customizable theme and content structure
   - Pre-configured for Claude Code editing
   - Includes example components and patterns

3. **Template Variants**
   - Portfolio/Personal (current amelia-astro)
   - E-commerce (ameliastamps variant)
   - Blog/Publication
   - Business/Corporate

4. **Configuration Management**
   - Environment-based configuration
   - Template metadata system
   - Client customization layer
   - Theme switching capability

## Technical Implementation

### 1. Template Configuration System
```typescript
// template.config.ts
export interface TemplateConfig {
  id: string;
  name: string;
  description: string;
  category: 'portfolio' | 'ecommerce' | 'blog' | 'business';
  features: string[];
  defaultContent: {
    pages: string[];
    components: string[];
    assets: string[];
  };
  customizable: {
    colors: boolean;
    fonts: boolean;
    layout: boolean;
    components: boolean;
  };
}

export const ameliaAstroTemplate: TemplateConfig = {
  id: 'amelia-astro',
  name: 'Portfolio Template',
  description: 'Professional portfolio and personal website template',
  category: 'portfolio',
  features: [
    'Responsive design',
    'Blog integration',
    'Contact forms',
    'SEO optimized',
    'Dark mode support',
  ],
  defaultContent: {
    pages: ['index', 'about', 'portfolio', 'blog', 'contact'],
    components: ['Header', 'Footer', 'Hero', 'ProjectCard', 'BlogPost'],
    assets: ['images/hero-bg.jpg', 'fonts/inter.woff2'],
  },
  customizable: {
    colors: true,
    fonts: true,
    layout: true,
    components: true,
  },
};
```

### 2. Multi-Site Configuration
```javascript
// astro.config.mjs with multi-site support
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';

const { SITE_MODE, SITE_URL, SITE_NAME } = loadEnv(
  process.env.NODE_ENV,
  process.cwd(),
  '',
);

// Configuration variants
const siteConfigs = {
  webordinary: {
    site: 'https://webordinary.com',
    base: '/',
    integrations: [
      // Marketing site specific integrations
      analytics(),
      contactForm(),
      pricingCalculator(),
    ],
  },
  template: {
    site: process.env.SITE_URL || 'http://localhost:4321',
    base: '/',
    integrations: [
      // Editor template integrations
      claudeCodeBridge(),
      livePreview(),
      contentEditor(),
    ],
  },
  client: {
    site: process.env.CLIENT_DOMAIN,
    base: '/',
    integrations: [
      // Client-specific integrations
      clientAnalytics(),
      ecommerce(),
    ],
  },
};

export default defineConfig({
  ...siteConfigs[SITE_MODE || 'template'],
  output: SITE_MODE === 'webordinary' ? 'static' : 'server',
  vite: {
    define: {
      'import.meta.env.SITE_MODE': JSON.stringify(SITE_MODE),
      'import.meta.env.SITE_NAME': JSON.stringify(SITE_NAME),
    },
  },
});
```

### 3. WebOrdinary.com Content Structure
```typescript
// WebOrdinary marketing site pages
webordinary.com/
├── src/pages/
│   ├── index.astro          // Landing page with hero
│   ├── features.astro       // Platform features
│   ├── pricing.astro        // Pricing plans
│   ├── demo.astro          // Interactive demo
│   ├── docs/
│   │   ├── getting-started.astro
│   │   ├── templates.astro
│   │   └── api.astro
│   ├── showcase/           // Client examples
│   │   ├── ameliastamps.astro
│   │   └── [client].astro
│   └── auth/
│       ├── login.astro
│       └── signup.astro
```

### 4. Template Initialization Service
```typescript
// Template initialization for new clients
@Injectable()
export class TemplateInitializerService {
  async initializeClientSite(params: {
    clientId: string;
    templateId: string;
    customization: ClientCustomization;
  }): Promise<ClientSite> {
    // Clone base template
    const templatePath = await this.cloneTemplate(params.templateId);
    
    // Apply client customization
    await this.applyCustomization(templatePath, params.customization);
    
    // Initialize git repository
    await this.initializeGitRepo(templatePath, params.clientId);
    
    // Create GitHub repository
    const repo = await this.createGitHubRepo(params.clientId);
    
    // Push initial commit
    await this.pushToGitHub(templatePath, repo.url);
    
    // Configure environment
    await this.setupEnvironment({
      clientId: params.clientId,
      domain: params.customization.domain,
      template: params.templateId,
    });
    
    return {
      clientId: params.clientId,
      repository: repo.url,
      previewUrl: `https://edit.webordinary.com/client/${params.clientId}`,
      customization: params.customization,
    };
  }
  
  private async applyCustomization(
    path: string,
    customization: ClientCustomization,
  ): Promise<void> {
    // Update site config
    const configPath = `${path}/src/config.ts`;
    const config = await this.readConfig(configPath);
    
    config.site = {
      ...config.site,
      name: customization.siteName,
      tagline: customization.tagline,
      logo: customization.logo,
    };
    
    config.theme = {
      colors: customization.colors || config.theme.colors,
      fonts: customization.fonts || config.theme.fonts,
    };
    
    await this.writeConfig(configPath, config);
    
    // Update content
    if (customization.initialContent) {
      await this.applyInitialContent(path, customization.initialContent);
    }
  }
}
```

### 5. Dynamic Template Loading
```astro
---
// Dynamic template component loading
import { getTemplate } from '@/lib/templates';

const template = await getTemplate(Astro.params.templateId);
const Component = await import(template.componentPath);
---

<Component.default {...Astro.props} />
```

### 6. Template Showcase Page
```astro
---
// src/pages/templates/index.astro for webordinary.com
import Layout from '@/layouts/Layout.astro';
import TemplateCard from '@/components/TemplateCard.astro';
import { getAvailableTemplates } from '@/lib/templates';

const templates = await getAvailableTemplates();
---

<Layout title="Website Templates - WebOrdinary">
  <section class="templates-hero">
    <h1>Choose Your Perfect Template</h1>
    <p>Professional templates that adapt to your brand</p>
  </section>
  
  <section class="template-categories">
    <div class="tabs">
      <button data-category="all">All Templates</button>
      <button data-category="portfolio">Portfolio</button>
      <button data-category="ecommerce">E-commerce</button>
      <button data-category="blog">Blog</button>
      <button data-category="business">Business</button>
    </div>
    
    <div class="template-grid">
      {templates.map(template => (
        <TemplateCard
          id={template.id}
          name={template.name}
          description={template.description}
          preview={template.previewUrl}
          features={template.features}
          category={template.category}
        />
      ))}
    </div>
  </section>
  
  <section class="template-demo">
    <h2>Try Before You Buy</h2>
    <p>Edit any template live with our AI assistant</p>
    <button class="demo-button" data-template="amelia-astro">
      Start Demo with Amelia Template
    </button>
  </section>
</Layout>

<style>
  .template-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
    gap: 2rem;
    padding: 2rem;
  }
  
  .tabs {
    display: flex;
    gap: 1rem;
    justify-content: center;
    margin: 2rem 0;
  }
  
  .tabs button {
    padding: 0.5rem 1rem;
    border: 2px solid transparent;
    background: #f5f5f5;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.3s;
  }
  
  .tabs button:hover,
  .tabs button.active {
    border-color: var(--primary-color);
    background: white;
  }
</style>

<script>
  // Template filtering
  document.querySelectorAll('[data-category]').forEach(button => {
    button.addEventListener('click', (e) => {
      const category = e.target.dataset.category;
      filterTemplates(category);
    });
  });
  
  // Demo initialization
  document.querySelector('.demo-button').addEventListener('click', async (e) => {
    const templateId = e.target.dataset.template;
    const response = await fetch('/api/demo/start', {
      method: 'POST',
      body: JSON.stringify({ templateId }),
    });
    const { demoUrl } = await response.json();
    window.open(demoUrl, '_blank');
  });
</script>
```

## Deployment Strategy

### WebOrdinary.com Production
```yaml
# GitHub Action for webordinary.com
name: Deploy WebOrdinary Marketing Site

on:
  push:
    branches: [main]
    paths:
      - 'amelia-astro/**'
      - '.github/workflows/deploy-webordinary.yml'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          
      - name: Install and Build
        run: |
          cd amelia-astro
          npm ci
          SITE_MODE=webordinary npm run build
          
      - name: Deploy to S3
        run: |
          aws s3 sync amelia-astro/dist/ s3://webordinary-marketing/ --delete
          aws cloudfront create-invalidation \
            --distribution-id $WEBORDINARY_DISTRIBUTION_ID \
            --paths "/*"
```

### Template Registry
```typescript
// Template registry for client deployments
const templateRegistry = {
  'amelia-astro': {
    repository: 'github.com/webordinary/amelia-astro-template',
    branch: 'main',
    setupScript: 'scripts/setup-client.sh',
    requiredEnvVars: ['SITE_NAME', 'SITE_URL', 'CLIENT_ID'],
  },
  'ameliastamps-ecommerce': {
    repository: 'github.com/webordinary/ecommerce-template',
    branch: 'main',
    setupScript: 'scripts/setup-ecommerce.sh',
    requiredEnvVars: ['SITE_NAME', 'SITE_URL', 'STRIPE_KEY', 'CLIENT_ID'],
  },
};
```

## Implementation Steps

### Phase 1: WebOrdinary.com Setup
1. Configure amelia-astro for dual-mode operation
2. Add marketing pages (features, pricing, docs)
3. Deploy to webordinary.com domain
4. Set up analytics and monitoring

### Phase 2: Template System
1. Create template configuration system
2. Build template initialization service
3. Implement client customization layer
4. Test template deployment flow

### Phase 3: Editor Integration
1. Connect template system to Claude Code
2. Implement live preview with template
3. Add template switching capability
4. Create template marketplace UI

### Phase 4: Client Onboarding
1. Build client signup flow
2. Template selection interface
3. Initial customization wizard
4. Automatic site provisioning

## Success Criteria

### WebOrdinary.com
- [ ] Marketing site live at webordinary.com
- [ ] All marketing pages functional
- [ ] Demo system working
- [ ] Documentation complete
- [ ] Analytics tracking

### Template System
- [ ] Template initialization working
- [ ] Client customization applied
- [ ] Git repositories created
- [ ] Preview environments ready
- [ ] Multiple templates available

### Integration
- [ ] Claude Code can edit templates
- [ ] Preview updates live
- [ ] Deployments work
- [ ] Client isolation maintained

## Dependencies
- Amelia-astro codebase ready
- WebOrdinary.com domain configured
- S3/CloudFront for marketing site
- Template storage system
- Client provisioning API

## Estimated Timeline
- WebOrdinary.com Setup: 4 hours
- Template System: 6 hours
- Editor Integration: 4 hours
- Client Onboarding: 4 hours
- **Total: 2-2.5 days**

## Notes
- Consider using Astro's content collections for template variants
- Plan for template versioning strategy
- Document template customization API
- Create template development guide
- Consider white-label options for enterprise