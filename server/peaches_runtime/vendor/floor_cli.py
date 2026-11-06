"""Read-only command-line interface for the PEACHES Floor v1 reference checker."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .floor import derive_rubric_id, verify_floor_stamp, verify_observation


def _read(path: str) -> bytes:
    return sys.stdin.buffer.read() if path == "-" else Path(path).read_bytes()


def _write(report: dict) -> None:
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Read-only, non-authoritative PEACHES Floor v1 reference checker; "
            "it never signs, issues, admits, or registers a stamp"
        )
    )
    commands = parser.add_subparsers(dest="command", required=True)

    stamp = commands.add_parser("stamp", help="check one issuer-created stamp")
    stamp.add_argument("stamp_file", help="JSON file, or - for standard input")
    stamp.add_argument(
        "--observation",
        action="append",
        default=[],
        metavar="FILE",
        help="detached observation JSON; may be repeated",
    )

    observation = commands.add_parser(
        "observation", help="check detached observation structure only"
    )
    observation.add_argument("observation_file", help="JSON file, or - for stdin")
    observation.add_argument("--stamp-id", help="expected stamp identifier")
    observation.add_argument("--claimed-at", help="signed claimed_at for ordering")

    rubric = commands.add_parser(
        "rubric-id", help="derive an identifier for exact detached rubric bytes"
    )
    rubric.add_argument("media_type")
    rubric.add_argument("rubric_file", help="exact rubric bytes, or - for stdin")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command == "stamp":
        observations = [_read(path) for path in args.observation]
        report = verify_floor_stamp(_read(args.stamp_file), observations=observations)
        _write(report)
        return 0 if report["status"] == "VALID_FLOOR_STRUCTURE_AND_SIGNATURE" else 1
    if args.command == "observation":
        report = verify_observation(
            _read(args.observation_file),
            expected_stamp_id=args.stamp_id,
            claimed_at=args.claimed_at,
        )
        _write(report)
        # Exit success means only that the Floor wrapper is internally
        # consistent.  Its method and time claim remain explicitly unverified.
        return 0 if report["status"] == "ATTACHED_UNVERIFIED" else 1

    rubric_id = derive_rubric_id(args.media_type, _read(args.rubric_file))
    _write(
        {
            "status": "DERIVED_CONTENT_IDENTIFIER",
            "rubric_id": rubric_id,
            "claim": "content_identity_only",
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
