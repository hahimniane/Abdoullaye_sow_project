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
