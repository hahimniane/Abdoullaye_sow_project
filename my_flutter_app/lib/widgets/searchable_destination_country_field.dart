import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../models/destination_country.dart';

class SearchableDestinationCountryField extends StatelessWidget {
  const SearchableDestinationCountryField({
    super.key,
    required this.countries,
    required this.value,
    required this.onChanged,
    required this.label,
    required this.requiredMessage,
  });

  final List<DestinationCountry> countries;
  final DestinationCountry? value;
  final ValueChanged<DestinationCountry> onChanged;
  final String label;
  final String requiredMessage;

  Future<void> _showPicker(BuildContext context) async {
    final selected = await showModalBottomSheet<DestinationCountry>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) =>
          _DestinationCountrySheet(countries: countries, selectedId: value?.id),
    );
    if (selected != null) onChanged(selected);
  }

  @override
  Widget build(BuildContext context) {
    return FormField<DestinationCountry>(
      initialValue: value,
      validator: (_) => value == null ? requiredMessage : null,
      builder: (field) {
        return InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: countries.isEmpty ? null : () => _showPicker(context),
          child: InputDecorator(
            decoration: InputDecoration(
              labelText: label,
              errorText: field.errorText,
              suffixIcon: const Icon(Icons.search),
              border: InputBorder.none,
            ),
            child: value == null
                ? Text(
                    label,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  )
                : _CountryOption(country: value!),
          ),
        );
      },
    );
  }
}

class _DestinationCountrySheet extends StatefulWidget {
  const _DestinationCountrySheet({
    required this.countries,
    required this.selectedId,
  });

  final List<DestinationCountry> countries;
  final String? selectedId;

  @override
  State<_DestinationCountrySheet> createState() =>
      _DestinationCountrySheetState();
}

class _DestinationCountrySheetState extends State<_DestinationCountrySheet> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final normalizedQuery = _query.trim().toLowerCase();
    final filtered = widget.countries.where((country) {
      if (normalizedQuery.isEmpty) return true;
      return country.name.toLowerCase().contains(normalizedQuery) ||
          country.displayCode.toLowerCase().contains(normalizedQuery);
    }).toList();

    return FractionallySizedBox(
      heightFactor: 0.78,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 12),
            child: TextField(
              autofocus: true,
              decoration: InputDecoration(
                hintText: l10n.searchDestinationCountry,
                prefixIcon: const Icon(Icons.search),
              ),
              onChanged: (value) => setState(() => _query = value),
            ),
          ),
          Expanded(
            child: filtered.isEmpty
                ? Center(child: Text(l10n.noDestinationCountriesMatch))
                : ListView.separated(
                    padding: const EdgeInsets.fromLTRB(12, 0, 12, 24),
                    itemCount: filtered.length,
                    separatorBuilder: (_, _) => const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final country = filtered[index];
                      return ListTile(
                        leading: Text(
                          country.flagEmoji,
                          style: const TextStyle(fontSize: 24),
                        ),
                        title: Text(country.name),
                        subtitle: country.displayCode.isEmpty
                            ? null
                            : Text(country.displayCode),
                        trailing: country.id == widget.selectedId
                            ? const Icon(Icons.check_circle)
                            : null,
                        onTap: () => Navigator.of(context).pop(country),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

class _CountryOption extends StatelessWidget {
  const _CountryOption({required this.country});

  final DestinationCountry country;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(country.flagEmoji, style: const TextStyle(fontSize: 20)),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            country.displayNameWithCode,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}
