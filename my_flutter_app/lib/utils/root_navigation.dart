import 'package:flutter/material.dart';

Future<T?> pushRootNamed<T>(
  BuildContext context,
  String routeName, {
  Object? arguments,
}) {
  return Navigator.of(
    context,
    rootNavigator: true,
  ).pushNamed<T>(routeName, arguments: arguments);
}

Future<T?> replaceRootWithNamed<T>(
  BuildContext context,
  String routeName, {
  Object? arguments,
}) {
  return Navigator.of(context, rootNavigator: true).pushNamedAndRemoveUntil<T>(
    routeName,
    (route) => false,
    arguments: arguments,
  );
}
