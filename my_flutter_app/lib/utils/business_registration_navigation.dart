import 'package:flutter/material.dart';

import 'root_navigation.dart';

const businessRegistrationRoute = '/business-register';

Future<T?> openBusinessRegistration<T>(BuildContext context) {
  return pushRootNamed<T>(context, businessRegistrationRoute);
}
