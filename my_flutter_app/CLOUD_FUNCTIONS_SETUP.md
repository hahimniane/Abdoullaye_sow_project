# Cloud Functions Setup - Admin User Creation

## Overview

This implementation allows admins to create new staff users **without logging out** by using Firebase Cloud Functions with the Admin SDK.

## Architecture

```
User Management Screen
    ↓
Add Staff Screen (UI)
    ↓
AuthProvider.addStaffUser()
    ↓
Cloud Function: createStaffUser
    ↓
Firebase Admin SDK creates user
    ↓
Admin stays logged in! ✅
```

## How It Works

### Before (Problem)
- Admin uses Firebase Auth client SDK to create users
- Client SDK logs out the current user when creating a new one
- Admin gets logged out every time they add a staff member ❌

### After (Solution)
- Admin calls a Cloud Function
- Cloud Function uses Firebase Admin SDK
- Admin SDK creates users without affecting current session
- Admin stays logged in ✅

## File Structure

```
my_flutter_app/
├── functions/
│   ├── index.js              # Cloud Functions code
│   ├── package.json          # Dependencies
│   └── .eslintrc.js          # Linting config
├── lib/
│   ├── providers/
│   │   └── auth_provider.dart  # Updated to call Cloud Functions
│   └── screens/
│       ├── add_staff_screen.dart
│       └── user_management_screen.dart
└── pubspec.yaml              # Added cloud_functions dependency
```

## Deployment Steps

### 1. Deploy Cloud Functions

Run this command in your terminal:

```bash
cd /Users/hashimniane/Project\ Dev/Abdoullaye_sow_project/my_flutter_app
firebase deploy --only functions
```

This will deploy three functions:
- `createStaffUser` - Creates new staff users
- `updateUserRole` - Updates user roles
- `deleteUser` - Deletes user accounts

**Expected deployment time:** 3-5 minutes

### 2. Verify Deployment

After deployment, you should see:

```
✔ functions[createStaffUser(us-central1)]: Successful create operation.
✔ functions[updateUserRole(us-central1)]: Successful create operation.
✔ functions[deleteUser(us-central1)]: Successful create operation.
```

### 3. Test the Implementation

1. **Run your Flutter app:**
   ```bash
   flutter run
   ```

2. **Login as an admin user**

3. **Navigate to User Management:**
   - From the home screen, tap "User Management"

4. **Create a new staff user:**
   - Tap the "+" FAB button
   - Enter email and password
   - Tap "Add Staff Member"

5. **Verify:**
   - Success message appears
   - New staff user appears in the list
   - **You're still logged in!** ✅

## Cloud Functions Details

### createStaffUser

**Purpose:** Creates a new staff user account

**Security:**
- Requires authentication
- Only users with `role: 'admin'` can execute
- Validates email format
- Enforces minimum password length (6 characters)

**Parameters:**
```javascript
{
  email: "newstaff@example.com",
  password: "securePassword123"
}
```

**Response:**
```javascript
{
  success: true,
  uid: "user-unique-id",
  email: "newstaff@example.com",
  message: "Staff user created successfully"
}
```

### updateUserRole

**Purpose:** Changes a user's role

**Security:**
- Requires authentication
- Only admins can execute
- Validates role is one of: customer, staff, admin

**Parameters:**
```javascript
{
  userId: "user-unique-id",
  newRole: "staff" // or "customer", "admin"
}
```

### deleteUser

**Purpose:** Deletes a user account

**Security:**
- Requires authentication
- Only admins can execute
- Prevents self-deletion

**Parameters:**
```javascript
{
  userId: "user-unique-id"
}
```

## Error Handling

The implementation handles these error cases:

| Error | Meaning | User Message |
|-------|---------|--------------|
| `unauthenticated` | Not logged in | "You must be authenticated to create users." |
| `permission-denied` | Not an admin | "Only admins can create new staff users." |
| `invalid-argument` | Bad input | "Invalid input provided." |
| `already-exists` | Email in use | "A user with this email already exists." |
| `internal` | Server error | "An internal error occurred. Please try again." |

## Monitoring

### View Function Logs

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project: "Car Selling Flutter App"
3. Click "Functions" in the left menu
4. Click on a function to view logs

### Check Function Status

```bash
firebase functions:log --only createStaffUser
```

## Troubleshooting

### Issue: "Function not found"

**Solution:** Deploy the functions:
```bash
firebase deploy --only functions
```

### Issue: "Permission denied"

**Cause:** The calling user doesn't have `role: 'admin'` in Firestore

**Solution:**
1. Go to Firebase Console → Firestore
2. Find the user's document in the `users` collection
3. Set `role: 'admin'`

### Issue: "Email already exists"

**Cause:** The email is already registered

**Solution:** Use a different email address or delete the existing user first

### Issue: NPM Permission Errors

**Solution:** Use a temporary cache directory:
```bash
cd functions
npm install --cache /tmp/npm-cache
```

## Cost Considerations

Firebase Cloud Functions pricing (Free tier included):

- **Free tier:** 2M invocations/month
- **Paid:** $0.40 per million invocations after free tier
- **Expected usage:** Very low (only when admins create users)

For typical usage (creating a few staff users per day), you'll stay well within the free tier.

## Security Best Practices

✅ **Implemented:**
- Admin role verification
- Input validation
- Authentication required
- Error handling
- Audit trail (createdBy field)

🔒 **Optional Enhancements:**
- Enable App Check (set `enforceAppCheck: true`)
- Add rate limiting
- Email verification for new users
- Webhook notifications

## Next Steps

1. **Deploy the functions** (run the deployment command above)
2. **Test with your admin account**
3. **Monitor the logs** for the first few uses
4. **(Optional) Enable App Check** for additional security

## Support

If you encounter issues:
1. Check Firebase Console logs
2. Review the Flutter console output
3. Verify admin role in Firestore
4. Ensure all Firebase APIs are enabled

---

**Created:** November 7, 2025
**Flutter Version:** 3.7.2+
**Firebase Functions:** v2 (Node.js 22)
**Status:** ✅ Ready to deploy

