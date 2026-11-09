"""Experimental EQM for paired aggregate values; not an operational fire model."""
from bisect import bisect_right
from math import isfinite

def fit(source, reference):
    if len(source) != len(reference) or len(source) < 5:
        raise ValueError('Need at least five paired observations')
    if any(not isfinite(v) or v < 0 for v in [*source, *reference]):
        raise ValueError('Inputs must be finite and nonnegative')
    positive_source = sorted(v for v in source if v > 0)
    positive_reference = sorted(v for v in reference if v > 0)
    if not positive_source or not positive_reference:
        raise ValueError('Positive training support required')
    return {'source': positive_source, 'reference': positive_reference}

def transform(model, value):
    if not isfinite(value) or value < 0:
        raise ValueError('Input must be finite and nonnegative')
    if value == 0:
        return {'value': 0., 'outside_support': False}
    source, reference = model['source'], model['reference']
    rank = bisect_right(source, value) / len(source)
    position = max(0., min(len(reference)-1., rank * len(reference)-1))
    lower = int(position)
    upper = min(lower+1, len(reference)-1)
    result = reference[lower] + (reference[upper]-reference[lower]) * (position-lower)
    return {'value': result, 'outside_support': value < source[0] or value > source[-1]}

def mae(predicted, observed):
    if len(predicted) != len(observed) or not observed:
        raise ValueError('Nonempty paired test observations required')
    return sum(abs(a-b) for a,b in zip(predicted, observed)) / len(observed)
