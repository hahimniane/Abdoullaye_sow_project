import 'package:flutter/material.dart';

import 'root_navigation.dart';

const forgotPasswordRoute = '/forgot-password';
const staffHomeRoute = '/staff-home';
const customerHomeRoute = '/';

Future<T?> openForgotPassword<T>(BuildContext context) {
  return pushRootNamed<T>(context, forgotPasswordRoute);
}

Future<T?> navigateAfterLogin<T>(
  BuildContext context, {
  required bool hasBusinessDashboardAccess,
}) {
  return replaceRootWithNamed<T>(
    context,
    hasBusinessDashboardAccess ? staffHomeRoute : customerHomeRoute,
  );
}

const myPackagesRoute = '/my-packages';

/// Where a phone sign-in started from a tracking link lands
/// (docs/PHONE_ACCOUNTS.md §10): a business account goes to its dashboard as
/// after any sign-in; everyone else sees My packages, over the home screen,
/// in place of the tracking page they came from.
Future<T?> openAfterTrackingSignIn<T>(
  BuildContext context, {
  required bool hasBusinessDashboardAccess,
}) {
  if (hasBusinessDashboardAccess) {
    return navigateAfterLogin<T>(context, hasBusinessDashboardAccess: true);
  }
  return Navigator.of(context, rootNavigator: true)
      .pushNamedAndRemoveUntil<dynamic>(
        myPackagesRoute,
        (route) => route.isFirst,
      )
      .then((result) => result as T?);
}
