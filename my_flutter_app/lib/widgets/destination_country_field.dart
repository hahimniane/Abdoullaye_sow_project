import 'package:flutter/material.dart';

import '../models/destination_country.dart';
import '../services/destination_country_service.dart';

class DestinationCountryField extends StatelessWidget {
  const DestinationCountryField({
    super.key,
    required this.value,
    required this.onChanged,
    required this.label,
    required this.requiredMessage,
  });

  final DestinationCountry? value;
  final ValueChanged<DestinationCountry?> onChanged;
  final String label;
  final String requiredMessage;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<DestinationCountry>>(
      stream: DestinationCountryService().activeCountries(),
      builder: (context, snapshot) {
        final countries = snapshot.data ?? <DestinationCountry>[];
        final currentValue =
            value != null && countries.any((country) => country.id == value!.id)
            ? value!.id
            : null;

        if (snapshot.hasError) {
          return Text(snapshot.error.toString());
        }

        if (!snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }

        return DropdownButtonFormField<String>(
          initialValue: currentValue,
          items: countries
              .map(
                (country) => DropdownMenuItem<String>(
                  value: country.id,
                  child: Text(country.name),
                ),
              )
              .toList(),
          onChanged: (id) {
            onChanged(
              countries.where((country) => country.id == id).firstOrNull,
            );
          },
          decoration: InputDecoration(labelText: label),
          validator: (id) => id == null ? requiredMessage : null,
        );
      },
    );
  }
}
