# Mobile Storage Setup Guide

## OneDrive Integration Setup

To enable OneDrive storage (required for mobile access), you need to register this app with Microsoft Azure:

### Step 1: Register App in Azure Portal

1. Go to [Azure App Registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Click **"New registration"**
3. Fill out the form:
   - **Name**: `Food Tracker`
   - **Supported account types**: `Accounts in any organizational directory and personal Microsoft accounts`
   - **Redirect URI**: 
     - Type: `Web`
     - URL: `https://shivbijlani.github.io/food-tracker/`
4. Click **"Register"**

### Step 2: Configure App Permissions

1. After registration, go to **"API permissions"**
2. Click **"Add a permission"**
3. Select **"Microsoft Graph"**
4. Choose **"Delegated permissions"**
5. Add these permissions:
   - `Files.ReadWrite` (to read/write files in OneDrive)
   - `offline_access` (to maintain login between sessions)
6. Click **"Add permissions"**

### Step 3: Update App Code

1. From the app registration **"Overview"** page, copy the **"Application (client) ID"**
2. Edit `src/storage/onedrive-provider.js` 
3. Replace `TODO_REPLACE_WITH_AZURE_APP_ID` with your actual client ID
4. Commit and push the changes

### Step 4: Test Mobile Access

1. Open the app on mobile: https://shivbijlani.github.io/food-tracker/
2. Choose **"OneDrive"** storage option
3. Complete the Microsoft OAuth login
4. Your food tracking data will now sync across all devices!

## Why This Setup Is Needed

The app runs entirely in your browser with no backend server. To access OneDrive files, Microsoft requires OAuth2 authentication with a registered app ID. This is a one-time setup that enables mobile access and cross-device sync.

Your data remains private - it's stored in your personal OneDrive folder (`/food-tracker/`) and only you have access.

## Alternative: Local Storage Only

If you prefer to keep using the local folder option (desktop only):
- Choose **"Local Folder"** in the storage picker
- Your data stays on your computer in markdown files
- No mobile access, but no cloud registration needed

## Support

If you need help with Azure app registration, feel free to create an issue on the GitHub repository.