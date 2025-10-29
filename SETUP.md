# 🚀 Setup Guide for LinkHub Crawlers

## Step 1: Create GitHub Repository

1. Go to [GitHub](https://github.com/new)
2. Create a new repository:
   - Name: `linkhub-crawlers`
   - Description: `Web crawlers for LinkHub - Automated content collection`
   - **Visibility: Public** ✅
   - **DO NOT** initialize with README (we already have one)

## Step 2: Push to GitHub

```bash
cd /Users/woosublee/Documents/Cursor/Personal/Dev/linkhub-crawlers

# Add remote origin (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/linkhub-crawlers.git

# Push to GitHub
git branch -M main
git push -u origin main
```

## Step 3: Verify GitHub Actions

1. Go to your repository on GitHub
2. Click **Actions** tab
3. You should see 3 workflows:
   - Ppomppu NaverPay Crawler
   - Ppomppu JJizzle Crawler
   - Quiz Crawler

## Step 4: Test Manual Run (Optional)

1. Go to **Actions** tab
2. Select any workflow (e.g., "Ppomppu NaverPay Crawler")
3. Click **Run workflow** → **Run workflow**
4. Wait for completion
5. Check if `crawled_posts.json` is updated in the commit history

## ✅ Verification Checklist

- [ ] Repository created on GitHub as **public**
- [ ] All files pushed successfully
- [ ] GitHub Actions workflows visible
- [ ] README displays correctly
- [ ] No sensitive information exposed (tokens, passwords)

## 🔐 Security Notes

This repository is **PUBLIC**, which means:
- ✅ Anyone can see the code
- ✅ Anyone can see crawled history files (just URLs, safe to share)
- ✅ API endpoint URL is visible (this is okay, it's public)
- ❌ NO sensitive tokens or passwords in the code (already removed)

The crawlers will automatically run on schedule and register content to your LinkHub service!

## 🎯 Next Steps

After pushing to GitHub, you can:
1. Monitor the Actions tab for automated runs
2. Check your LinkHub service for newly registered content
3. Customize crawler schedules in `.github/workflows/` files if needed

## 📝 Notes

- First run might take a few minutes as GitHub Actions sets up the environment
- Crawled history files will be automatically updated via commits
- GitHub Actions uses the free tier (should be sufficient for these schedules)
