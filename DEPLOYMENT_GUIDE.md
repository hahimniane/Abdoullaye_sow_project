# Firebase Functions Deployment Guide

This guide explains how to deploy the Firebase Cloud Functions that enable admin users to create new staff users without logging out.

## Prerequisites

1. Firebase CLI installed (`npm install -g firebase-tools`)
2. You're logged in to Firebase (`firebase login`)
3. Your Firebase project is selected

## Steps to Deploy

### 1. Install Dependencies

Navigate to the functions directory and install dependencies:

```bash
cd functions
npm install
```

### 2. Select Your Firebase Project

If you haven't already, select your Firebase project:

```bash
firebase use your-project-id
```

### 3. Deploy the Functions

Deploy all functions:

```bash
firebase deploy --only functions
```

Or deploy specific functions:

```bash
firebase deploy --only functions:createStaffUser,functions:updateUserRole,functions:deleteUser
```

### 4. Verify Deployment

After successful deployment, you should see output like:

```
✔ Deploy complete!

Project Console: https://console.firebase.google.com/project/your-project-id/overview
```

## Functions Overview

### 1. `createStaffUser`
- **Purpose**: Creates a new user account without logging out the admin
- **Required Role**: Admin
- **Parameters**: 
  - `email`: Email address for the new user
  - `password`: Password for the new user (minimum 6 characters)
- **Creates**: 
  - Firebase Auth account
  - Firestore document with `role: 'staff'`

### 2. `updateUserRole`
- **Purpose**: Updates a user's role
- **Required Role**: Admin
- **Parameters**:
  - `userId`: The user ID to update
  - `newRole`: One of 'customer', 'staff', or 'admin'

### 3. `deleteUser`
- **Purpose**: Deletes a user account
- **Required Role**: Admin
- **Parameters**:
  - `userId`: The user ID to delete
- **Note**: Admins cannot delete their own account

## Security Rules

These functions include the following security measures:

1. **Authentication Required**: All functions require the caller to be authenticated
2. **Admin Role Check**: Only users with `role: 'admin'` in their Firestore document can execute these functions
3. **Input Validation**: All inputs are validated before processing
4. **Error Handling**: Detailed error messages for debugging

## Testing

To test locally before deployment:

```bash
cd functions
npm run serve
```

This will start the Firebase emulators for local testing.

## Monitoring

Monitor function execution in the Firebase Console:

1. Go to Firebase Console
2. Select "Functions" from the left menu
3. View logs, metrics, and health status

## Common Issues

### Function Not Found
- Ensure functions are deployed: `firebase deploy --only functions`
- Check function names match exactly in client code

### Permission Denied
- Verify the calling user has `role: 'admin'` in Firestore
- Ensure authentication token is valid

### Email Already Exists
- The email is already registered in Firebase Auth
- Use a different email address

## Environment Configuration

If you need to set environment variables:

```bash
firebase functions:config:set app.name="Your App Name"
```

Then redeploy the functions.

## Rollback

To rollback to a previous version:

1. Go to Firebase Console > Functions
2. Click on the function name
3. Go to "Version history"
4. Select the version to rollback to
5. Click "Roll back"

## Support

For issues or questions:
1. Check Firebase Functions logs in the console
2. Review error messages in the app console
3. Ensure all dependencies are up to date
