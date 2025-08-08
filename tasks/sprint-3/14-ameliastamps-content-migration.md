# Task 13: Complete ameliastamps.com Content Migration

## Overview
Migrate the full ameliastamps.com website content from the existing platform to the new Astro-based WebOrdinary system, ensuring all pages, images, products, and functionality are properly transferred and optimized.

## Background
- Current site has placeholder/stub content
- Need complete content migration for production readiness
- Existing site structure must be preserved
- SEO and performance must be maintained or improved

## Requirements

### Content Inventory
1. **Pages to Migrate**
   - Homepage with hero sections
   - Product catalog (all stamp products)
   - Individual product pages
   - About Us page
   - Contact page
   - Blog/News section
   - Policies (shipping, returns, privacy)
   - FAQ section

2. **Media Assets**
   - Product images (high-res and thumbnails)
   - Gallery images
   - Logo and branding assets
   - Icons and illustrations
   - PDF downloads (if any)

3. **Product Data**
   - Product titles and descriptions
   - Pricing information
   - SKUs and inventory status
   - Categories and tags
   - Related products
   - Customer reviews (if any)

4. **SEO Elements**
   - Meta titles and descriptions
   - Open Graph tags
   - Structured data (JSON-LD)
   - XML sitemap
   - Robots.txt
   - Redirects from old URLs

## Technical Implementation

### 1. Content Migration Script
```typescript
// Automated content extraction and migration
class ContentMigrator {
  private sourceUrl = 'https://ameliastamps.com';
  private targetPath = '/workspace/ameliastamps';
  
  async migrateAllContent(): Promise<MigrationReport> {
    const report: MigrationReport = {
      pages: [],
      images: [],
      products: [],
      errors: [],
    };
    
    try {
      // Step 1: Crawl existing site
      const siteMap = await this.crawlSite(this.sourceUrl);
      
      // Step 2: Extract content from each page
      for (const page of siteMap.pages) {
        const content = await this.extractPageContent(page.url);
        report.pages.push(await this.migratePage(content));
      }
      
      // Step 3: Migrate products
      const products = await this.extractProducts();
      for (const product of products) {
        report.products.push(await this.migrateProduct(product));
      }
      
      // Step 4: Migrate media assets
      const assets = await this.extractMediaAssets();
      for (const asset of assets) {
        report.images.push(await this.migrateAsset(asset));
      }
      
      // Step 5: Generate Astro components
      await this.generateAstroComponents(report);
      
      return report;
    } catch (error) {
      report.errors.push({
        type: 'critical',
        message: error.message,
        timestamp: new Date(),
      });
      throw error;
    }
  }
  
  private async extractPageContent(url: string): Promise<PageContent> {
    const response = await fetch(url);
    const html = await response.text();
    const $ = cheerio.load(html);
    
    return {
      title: $('title').text(),
      metaDescription: $('meta[name="description"]').attr('content'),
      heading: $('h1').first().text(),
      content: this.cleanHtml($('.content').html()),
      images: this.extractImages($),
      seo: this.extractSEO($),
    };
  }
  
  private async migrateProduct(product: Product): Promise<MigratedProduct> {
    // Create Astro component for product
    const component = `---
import Layout from '@/layouts/Layout.astro';
import ProductGallery from '@/components/ProductGallery.astro';
import AddToCart from '@/components/AddToCart.astro';

const product = {
  id: '${product.id}',
  title: '${product.title}',
  price: ${product.price},
  description: \`${product.description}\`,
  images: ${JSON.stringify(product.images)},
  sku: '${product.sku}',
  category: '${product.category}',
  inStock: ${product.inStock},
};
---

<Layout title={product.title} description={product.description}>
  <div class="product-page">
    <ProductGallery images={product.images} />
    <div class="product-info">
      <h1>{product.title}</h1>
      <p class="price">\${product.price}</p>
      <div class="description" set:html={product.description} />
      <AddToCart product={product} />
    </div>
  </div>
</Layout>

<style>
  .product-page {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2rem;
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
  }
  
  @media (max-width: 768px) {
    .product-page {
      grid-template-columns: 1fr;
    }
  }
</style>`;
    
    const filePath = `${this.targetPath}/src/pages/products/${product.slug}.astro`;
    await this.writeFile(filePath, component);
    
    return {
      ...product,
      astroPath: filePath,
      migratedAt: new Date(),
    };
  }
}
```

### 2. Astro Site Structure
```typescript
// Generate proper Astro site structure
ameliastamps/
├── src/
│   ├── pages/
│   │   ├── index.astro           # Homepage
│   │   ├── about.astro           # About page
│   │   ├── contact.astro         # Contact page
│   │   ├── products/
│   │   │   ├── index.astro       # Product catalog
│   │   │   └── [slug].astro      # Dynamic product pages
│   │   ├── blog/
│   │   │   ├── index.astro       # Blog listing
│   │   │   └── [slug].astro      # Blog posts
│   │   └── policies/
│   │       ├── shipping.astro
│   │       ├── returns.astro
│   │       └── privacy.astro
│   ├── components/
│   │   ├── Header.astro
│   │   ├── Footer.astro
│   │   ├── ProductCard.astro
│   │   ├── ProductGallery.astro
│   │   ├── AddToCart.astro
│   │   └── Newsletter.astro
│   ├── layouts/
│   │   └── Layout.astro
│   └── styles/
│       └── global.css
├── public/
│   ├── images/
│   │   ├── products/
│   │   ├── gallery/
│   │   └── icons/
│   └── favicon.ico
└── astro.config.mjs
```

### 3. Product Catalog Component
```astro
---
// src/pages/products/index.astro
import Layout from '@/layouts/Layout.astro';
import ProductCard from '@/components/ProductCard.astro';
import { getProducts } from '@/lib/products';

const products = await getProducts();
const categories = [...new Set(products.map(p => p.category))];
---

<Layout title="Stamp Collection" description="Browse our collection of unique stamps">
  <div class="catalog">
    <aside class="filters">
      <h2>Categories</h2>
      <ul>
        <li><a href="/products">All Products</a></li>
        {categories.map(cat => (
          <li><a href={`/products?category=${cat}`}>{cat}</a></li>
        ))}
      </ul>
    </aside>
    
    <main class="products">
      <h1>Our Stamp Collection</h1>
      <div class="product-grid">
        {products.map(product => (
          <ProductCard product={product} />
        ))}
      </div>
    </main>
  </div>
</Layout>

<style>
  .catalog {
    display: grid;
    grid-template-columns: 250px 1fr;
    gap: 2rem;
    max-width: 1400px;
    margin: 0 auto;
    padding: 2rem;
  }
  
  .product-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 2rem;
  }
  
  .filters {
    background: #f5f5f5;
    padding: 1.5rem;
    border-radius: 8px;
    height: fit-content;
    position: sticky;
    top: 20px;
  }
  
  @media (max-width: 768px) {
    .catalog {
      grid-template-columns: 1fr;
    }
    
    .filters {
      position: static;
    }
  }
</style>
```

### 4. Image Optimization Pipeline
```typescript
// Optimize images during migration
import sharp from 'sharp';

class ImageOptimizer {
  async optimizeProductImages(imagePath: string): Promise<OptimizedImages> {
    const original = await sharp(imagePath);
    const metadata = await original.metadata();
    
    // Generate multiple sizes
    const sizes = {
      thumbnail: { width: 150, height: 150 },
      small: { width: 300, height: 300 },
      medium: { width: 600, height: 600 },
      large: { width: 1200, height: 1200 },
    };
    
    const optimized: OptimizedImages = {};
    
    for (const [size, dimensions] of Object.entries(sizes)) {
      const outputPath = imagePath.replace(
        /\.([^.]+)$/,
        `-${size}.$1`,
      );
      
      await sharp(imagePath)
        .resize(dimensions.width, dimensions.height, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85, progressive: true })
        .toFile(outputPath);
      
      optimized[size] = outputPath;
    }
    
    // Generate WebP versions
    await sharp(imagePath)
      .webp({ quality: 85 })
      .toFile(imagePath.replace(/\.[^.]+$/, '.webp'));
    
    return optimized;
  }
}
```

### 5. SEO Migration
```typescript
// Preserve and enhance SEO
class SEOMigrator {
  async generateSitemap(pages: Page[]): Promise<void> {
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(page => `  <url>
    <loc>https://ameliastamps.com${page.path}</loc>
    <lastmod>${page.lastModified}</lastmod>
    <changefreq>${page.changeFreq || 'weekly'}</changefreq>
    <priority>${page.priority || '0.5'}</priority>
  </url>`).join('\n')}
</urlset>`;
    
    await this.writeFile('public/sitemap.xml', sitemap);
  }
  
  async setupRedirects(oldUrls: OldUrl[]): Promise<void> {
    const redirects = oldUrls
      .map(url => `${url.from} ${url.to} 301`)
      .join('\n');
    
    await this.writeFile('public/_redirects', redirects);
  }
  
  async generateStructuredData(product: Product): Promise<string> {
    return JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.title,
      description: product.description,
      image: product.images[0],
      sku: product.sku,
      offers: {
        '@type': 'Offer',
        price: product.price,
        priceCurrency: 'USD',
        availability: product.inStock 
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
      },
    });
  }
}
```

### 6. Content Validation
```typescript
// Validate migrated content
class ContentValidator {
  async validateMigration(report: MigrationReport): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    
    // Check for missing images
    for (const page of report.pages) {
      const missingImages = await this.checkImages(page);
      if (missingImages.length > 0) {
        issues.push({
          type: 'error',
          page: page.path,
          message: `Missing images: ${missingImages.join(', ')}`,
        });
      }
    }
    
    // Validate internal links
    const brokenLinks = await this.checkInternalLinks(report.pages);
    issues.push(...brokenLinks);
    
    // Check SEO elements
    for (const page of report.pages) {
      if (!page.metaTitle || page.metaTitle.length > 60) {
        issues.push({
          type: 'warning',
          page: page.path,
          message: 'Meta title missing or too long',
        });
      }
    }
    
    // Verify product data
    for (const product of report.products) {
      if (!product.price || product.price <= 0) {
        issues.push({
          type: 'error',
          product: product.id,
          message: 'Invalid price',
        });
      }
    }
    
    return {
      valid: issues.filter(i => i.type === 'error').length === 0,
      issues,
      summary: {
        pages: report.pages.length,
        products: report.products.length,
        images: report.images.length,
        errors: issues.filter(i => i.type === 'error').length,
        warnings: issues.filter(i => i.type === 'warning').length,
      },
    };
  }
}
```

## Implementation Steps

### Phase 1: Content Audit
1. Crawl existing ameliastamps.com
2. Create complete content inventory
3. Identify all assets and dependencies
4. Document current site structure

### Phase 2: Migration Scripts
1. Build content extraction tools
2. Create Astro component generators
3. Implement image optimization pipeline
4. Set up data transformation logic

### Phase 3: Content Migration
1. Run migration scripts
2. Validate all content transferred
3. Optimize images and assets
4. Generate Astro components

### Phase 4: Quality Assurance
1. Visual comparison with original
2. Test all internal links
3. Verify product functionality
4. Check mobile responsiveness
5. SEO audit and validation

## Migration Checklist

### Pre-Migration
- [ ] Full site backup created
- [ ] Content inventory completed
- [ ] Migration scripts tested
- [ ] Staging environment ready

### During Migration
- [ ] Homepage content migrated
- [ ] All product pages created
- [ ] Product images optimized
- [ ] Blog posts transferred
- [ ] Policy pages updated
- [ ] Contact forms configured

### Post-Migration
- [ ] All links validated
- [ ] Images loading correctly
- [ ] SEO elements preserved
- [ ] Performance benchmarked
- [ ] Mobile experience tested
- [ ] Search functionality working

## Success Criteria

### Content Completeness
- [ ] 100% of pages migrated
- [ ] All products transferred
- [ ] All images optimized and accessible
- [ ] No broken links
- [ ] Forms functioning

### Performance Metrics
- [ ] Lighthouse score > 90
- [ ] Page load time < 3 seconds
- [ ] Image optimization > 50% reduction
- [ ] Core Web Vitals passing

### SEO Requirements
- [ ] Meta tags preserved
- [ ] Sitemap generated
- [ ] Redirects configured
- [ ] Structured data valid
- [ ] No 404 errors

## Testing Plan

### Automated Testing
```bash
# Run content validation
npm run validate:content

# Check for broken links
npm run test:links

# Validate SEO elements
npm run test:seo

# Performance testing
npm run lighthouse
```

### Manual Testing
1. Visual comparison of each page
2. Test purchase flow
3. Verify contact forms
4. Check responsive design
5. Test search functionality

## Rollback Plan
1. Keep original site running in parallel
2. DNS switch only after validation
3. Maintain database backups
4. Document all changes made
5. Quick revert procedure ready

## Dependencies
- Access to current ameliastamps.com
- Product database/API access
- High-resolution product images
- SEO data and analytics
- Form handler configuration

## Estimated Timeline
- Content Audit: 4 hours
- Migration Scripts: 6 hours
- Content Migration: 8 hours
- Testing & QA: 4 hours
- **Total: 2-3 days**

## Future Enhancements
- Add search functionality
- Implement customer reviews
- Add wishlist feature
- Create admin dashboard
- Add inventory management

## Notes
- Coordinate DNS switch with client
- Plan for minimal downtime
- Monitor 404s after launch
- Set up analytics tracking
- Document admin procedures