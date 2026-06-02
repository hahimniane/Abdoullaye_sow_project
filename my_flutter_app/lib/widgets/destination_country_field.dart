import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
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
        final l10n = AppLocalizations.of(context)!;
        final countries = snapshot.data ?? <DestinationCountry>[];
        final currentValue =
            value != null && countries.any((country) => country.id == value!.id)
            ? value!.id
            : null;

        if (snapshot.hasError) {
          return Container(
            width: double.infinity,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Theme.of(
                context,
              ).colorScheme.errorContainer.withValues(alpha: 0.45),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: Theme.of(
                  context,
                ).colorScheme.error.withValues(alpha: 0.18),
              ),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons.info_outline,
                  size: 20,
                  color: Theme.of(context).colorScheme.error,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    l10n.destinationCountriesUnavailable,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: Theme.of(context).colorScheme.onErrorContainer,
                      height: 1.35,
                    ),
                  ),
                ),
              ],
            ),
          );
        }

        if (!snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }

        if (countries.isEmpty) {
          return InputDecorator(
            decoration: InputDecoration(
              labelText: label,
              errorText: requiredMessage,
            ),
            child: Text(
              l10n.noApprovedDestinationsAvailable,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          );
        }

        return DropdownButtonFormField<String>(
          initialValue: currentValue,
          items: countries
              .map(
                (country) => DropdownMenuItem<String>(
                  value: country.id,
                  child: _CountryOption(country: country),
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

class _CountryOption extends StatelessWidget {
  const _CountryOption({required this.country});

  final DestinationCountry country;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(country.flagEmoji, style: const TextStyle(fontSize: 20)),
        const SizedBox(width: 10),
        Flexible(
          child: Text(
            country.displayNameWithCode,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}
