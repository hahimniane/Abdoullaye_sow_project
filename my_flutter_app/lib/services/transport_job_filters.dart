/// The accepted transport jobs list's search and status filter as pure
/// functions. Mirrors the website's `filteredJobs` in operations-panels.tsx
/// (search over reference, owner, vehicle, VIN, destination and status), with
/// the customer's phone added because a phone is how a carrier finds a job.
library;

import '../models/transport_request.dart';
import 'business_transport_jobs.dart';

/// The status a job shows and is moved from: `fulfillmentStatus` when it has
/// one, else `status`.
String transportJobShownStatus(TransportRequest job) =>
    transportJobCurrentStatus(<String, dynamic>{
      'fulfillmentStatus': job.fulfillmentStatus,
      'status': job.status,
    });

/// What the search reads for one job, lower case.
String transportJobSearchText(TransportRequest job) => [
  job.trackingCode,
  job.ownerName,
  job.carMake,
  job.carModel,
  job.carYear,
  job.vinNumber,
  job.destinationCountryName,
  job.customerPhone,
  transportJobShownStatus(job),
].join(' ').toLowerCase();

/// The statuses present among [jobs], for the filter's options: a state no
/// job is in would read as broken. Sorted for a steady order.
List<String> transportJobStatusesIn(Iterable<TransportRequest> jobs) {
  final seen = <String>{
    for (final job in jobs)
      if (transportJobShownStatus(job).isNotEmpty) transportJobShownStatus(job),
  };
  return seen.toList()..sort();
}

/// Jobs matching every word of [query] (any case) and, unless [status] is null
/// or `all`, that status. Keeps the order given.
List<TransportRequest> filterTransportJobs(
  List<TransportRequest> jobs, {
  String query = '',
  String? status,
}) {
  final words = query
      .toLowerCase()
      .split(RegExp(r'\s+'))
      .where((word) => word.isNotEmpty)
      .toList();
  final wanted = (status == null || status == 'all') ? null : status;
  if (words.isEmpty && wanted == null) return jobs;
  return [
    for (final job in jobs)
      if ((wanted == null || transportJobShownStatus(job) == wanted) &&
          (words.isEmpty || words.every(transportJobSearchText(job).contains)))
        job,
  ];
}
