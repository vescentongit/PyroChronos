import unittest
from harmonize import fit, transform, mae

class CalibrationTests(unittest.TestCase):
    def setUp(self):
        self.model = fit([0,1,2,3,4,5], [0,2,4,6,8,10])
    def test_zero_and_support(self):
        self.assertEqual(transform(self.model,0)['value'],0)
        self.assertTrue(transform(self.model,100)['outside_support'])
    def test_monotonic_mapping(self):
        values=[transform(self.model,x)['value'] for x in [0,1,2,3,4,5]]
        self.assertEqual(values,sorted(values))
        self.assertEqual(mae(values,[0,2,4,6,8,10]),0)
    def test_invalid_training_rejected(self):
        for source,reference in [([0]*5,[0]*5),([1,2],[1,2]),([1,2,3,4,float('nan')],[1]*5)]:
            with self.assertRaises(ValueError): fit(source,reference)

if __name__ == '__main__': unittest.main()
