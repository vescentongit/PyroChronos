"""Operational CLI errors never echo untrusted argument values."""
import argparse
import sys


class SafeArguments(argparse.ArgumentParser):
    def error(self, message):
        print("INVALID_REQUEST", file=sys.stderr)
        raise SystemExit(2)
