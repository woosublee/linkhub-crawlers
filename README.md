# LinkHub Crawlers 🤖

Web crawlers for [LinkHub](https://linkhub-dev.vercel.app) - Automated content collection from various Korean community sites.

## 📋 Overview

This repository contains automated crawlers that collect links and content from various sources and register them to the LinkHub service via API.

### Crawlers

1. **Ppomppu NaverPay Crawler** (`crawlers/ppomppu-naverpay/`)
   - Crawls Ppomppu coupon board for NaverPay related posts
   - Runs: Every hour at 7 minutes past
   - Extracts URLs from post content and registers to LinkHub

2. **Ppomppu JJizzle Crawler** (`crawlers/ppomppu-jjizzle/`)
   - Crawls Ppomppu phone & money boards for "쥐즐" (specific author) posts
   - Runs: Every hour at 13 minutes past
   - Registers post titles and links to LinkHub

3. **Quiz Crawler** (`crawlers/quiz/`)
   - Crawls daily quiz answers from various services (KB Pay, 신한SOL, H.point, etc.)
   - Runs: 3 times daily (00:10, 03:10, 10:10 KST)
   - Registers quiz answers as text cards to LinkHub

## 🚀 Quick Start

### Prerequisites

- Node.js 20 or higher
- npm or pnpm

### Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/linkhub-crawlers.git
cd linkhub-crawlers

# Install dependencies
npm install
```

### Running Crawlers

```bash
# Run individual crawlers
npm run crawl:naverpay
npm run crawl:jjizzle
npm run crawl:quiz
```

## 🔧 Configuration

The crawlers are configured to work with the LinkHub API at `https://linkhub-dev.vercel.app/api`.

If you need to change the API endpoint, modify the `API_BASE_URL` constant in each crawler file:

```javascript
const API_BASE_URL = 'https://your-api-domain.com/api';
```

## 🤖 Automated Runs

The crawlers run automatically via GitHub Actions:

- **Ppomppu NaverPay**: Hourly at 7 minutes past
- **Ppomppu JJizzle**: Hourly at 13 minutes past
- **Quiz Crawler**: Daily at 00:10, 03:10, 10:10 (KST)

You can also trigger runs manually via the "Actions" tab in GitHub.

## 📁 Project Structure

```
linkhub-crawlers/
├── .github/
│   └── workflows/          # GitHub Actions workflows
│       ├── ppomppu-naverpay.yml
│       ├── ppomppu-jjizzle.yml
│       └── quiz.yml
├── crawlers/
│   ├── ppomppu-naverpay/
│   │   ├── crawler.js
│   │   └── crawled_posts.json
│   ├── ppomppu-jjizzle/
│   │   ├── crawler.js
│   │   └── crawled_posts.json
│   └── quiz/
│       ├── crawler.js
│       └── crawled_quiz_posts.json
├── .gitignore
├── package.json
└── README.md
```

## 🛠 Technology Stack

- **Puppeteer**: Headless browser automation for web scraping
- **Axios**: HTTP client for API requests
- **Node.js**: Runtime environment

## 📝 How It Works

1. **Crawl**: Each crawler uses Puppeteer to navigate to target websites and extract content
2. **Parse**: Extract relevant information (titles, URLs, quiz answers, etc.)
3. **Deduplicate**: Check against local cache and database to avoid duplicate registrations
4. **Register**: Send new content to LinkHub API via POST requests
5. **Update**: Save crawled post IDs to prevent re-processing

## ⚠️ Important Notes

### Rate Limiting
- Crawlers implement delays between requests to respect target websites
- Default: 1-2 seconds between operations

### Duplicate Prevention
- Each crawler maintains a history file (`crawled_posts.json`)
- Checks against LinkHub database before registration
- Skips already processed content

### Error Handling
- Crawlers continue on individual failures
- Logs errors for debugging
- GitHub Actions reports overall status

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Guidelines

1. Follow existing code style
2. Test your changes locally before submitting
3. Update README if adding new features
4. Add comments for complex logic

## 📄 License

MIT

## 🔗 Related Projects

- [LinkHub Main Application](https://github.com/YOUR_USERNAME/linkhub) - The main LinkHub service

## ⚡ Troubleshooting

### Puppeteer Installation Issues

If you encounter Puppeteer installation errors:

```bash
# Install Chromium manually
cd node_modules/puppeteer && node install.mjs
```

### GitHub Actions Fails

Check the Actions tab for detailed error logs. Common issues:
- Network timeouts
- Website structure changes
- API rate limiting

## 📧 Contact

For questions or issues, please open an issue in this repository.

---

Made with ❤️ for the LinkHub community
