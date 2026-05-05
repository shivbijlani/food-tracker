/**
 * Google Drive provider using Drive API v3 with PKCE OAuth2
 */
import { StorageProvider } from './storage.js'

// Google Drive API configuration
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3'
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

// OAuth2 configuration - these will need to be registered in Google Cloud Console
const CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID' // Will be updated after app registration
const SCOPES = 'https://www.googleapis.com/auth/drive.file'
const FOLDER_NAME = 'food-tracker'

export class GoogleDriveProvider extends StorageProvider {
  constructor() {
    super()
    this.accessToken = null
    this.refreshToken = null
    this.expiresAt = null
    this.folderId = null
  }
  
  async init() {
    // TODO: Implement Google Drive OAuth2 with PKCE
    // Similar pattern to OneDrive but using Google endpoints
    throw new Error('Google Drive provider not yet implemented')
  }
  
  async isReady() {
    return false
  }
  
  async getFolderName() {
    return 'Google Drive/food-tracker'
  }
  
  async readFile(filename) {
    throw new Error('Google Drive provider not yet implemented')
  }
  
  async writeFile(filename, contents) {
    throw new Error('Google Drive provider not yet implemented')
  }
  
  async deleteFile(filename) {
    throw new Error('Google Drive provider not yet implemented')
  }
  
  async listFiles() {
    return []
  }
  
  async scaffold(isSimpleMode = false) {
    throw new Error('Google Drive provider not yet implemented')
  }
}