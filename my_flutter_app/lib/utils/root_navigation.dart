import 'package:flutter/material.dart';

Future<T?> pushRootNamed<T>(
  BuildContext context,
  String routeName, {
  Object? arguments,
}) {
  return Navigator.of(
    context,
    rootNavigator: true,
  ).pushNamed<dynamic>(routeName, arguments: arguments).then((result) {
    return result as T?;
  });
}

Future<T?> replaceRootWithNamed<T>(
  BuildContext context,
  String routeName, {
  Object? arguments,
}) {
  return Navigator.of(context, rootNavigator: true)
      .pushNamedAndRemoveUntil<dynamic>(
        routeName,
        (route) => false,
        arguments: arguments,
      )
      .then((result) {
        return result as T?;
      });
}
