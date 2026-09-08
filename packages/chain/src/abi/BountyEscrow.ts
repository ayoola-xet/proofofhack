export const bountyEscrowAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "asset_",
        type: "address",
        internalType: "contract IERC20",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "ADMISSION_TYPEHASH",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "ASSESSMENT_TYPEHASH",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "POLICY_TYPEHASH",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "admissionDigest",
    inputs: [
      {
        name: "admission",
        type: "tuple",
        internalType: "struct BountyEscrow.AdmissionV1",
        components: [
          {
            name: "bountyId",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "claimId",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "claimant",
            type: "address",
            internalType: "address",
          },
          {
            name: "evidenceCommitment",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "authorizationNonce",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "validUntil",
            type: "uint64",
            internalType: "uint64",
          },
        ],
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "assessmentDigest",
    inputs: [
      {
        name: "assessment",
        type: "tuple",
        internalType: "struct BountyEscrow.AssessmentV1",
        components: [
          {
            name: "bountyId",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "policyHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "claimId",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "claimant",
            type: "address",
            internalType: "address",
          },
          {
            name: "evidenceCommitment",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "caseNullifier",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "reportHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "adapterCodeHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "verifierConfigHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "outcome",
            type: "uint8",
            internalType: "uint8",
          },
          {
            name: "reward",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "assessedAt",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "validUntil",
            type: "uint64",
            internalType: "uint64",
          },
        ],
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "asset",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IERC20",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "collectPayment",
    inputs: [
      {
        name: "id",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "createAndFund",
    inputs: [
      {
        name: "policy",
        type: "tuple",
        internalType: "struct BountyEscrow.BountyPolicyV1",
        components: [
          {
            name: "settlementChainId",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "escrow",
            type: "address",
            internalType: "address",
          },
          {
            name: "organizationId",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "refundRecipient",
            type: "address",
            internalType: "address",
          },
          {
            name: "sourceChainId",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "sourceVault",
            type: "address",
            internalType: "address",
          },
          {
            name: "sourceBlockHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "fixtureManifestRoot",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "adapterId",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "adapterCodeHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "verifierConfigHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "admissionSigner",
            type: "address",
            internalType: "address",
          },
          {
            name: "verdictSigner",
            type: "address",
            internalType: "address",
          },
          {
            name: "reportRecipientKeyId",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "asset",
            type: "address",
            internalType: "address",
          },
          {
            name: "reward",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "minimumDiscrepancy",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "submissionDeadline",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "settlementDeadline",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "reservationDurationSeconds",
            type: "uint32",
            internalType: "uint32",
          },
          {
            name: "organizationNonce",
            type: "bytes32",
            internalType: "bytes32",
          },
        ],
      },
    ],
    outputs: [
      {
        name: "id",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "eip712Domain",
    inputs: [],
    outputs: [
      {
        name: "fields",
        type: "bytes1",
        internalType: "bytes1",
      },
      {
        name: "name",
        type: "string",
        internalType: "string",
      },
      {
        name: "version",
        type: "string",
        internalType: "string",
      },
      {
        name: "chainId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "verifyingContract",
        type: "address",
        internalType: "address",
      },
      {
        name: "salt",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "extensions",
        type: "uint256[]",
        internalType: "uint256[]",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "expireReservation",
    inputs: [
      {
        name: "id",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getBounty",
    inputs: [
      {
        name: "id",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct BountyEscrow.Bounty",
        components: [
          {
            name: "policy",
            type: "tuple",
            internalType: "struct BountyEscrow.BountyPolicyV1",
            components: [
              {
                name: "settlementChainId",
                type: "uint256",
                internalType: "uint256",
              },
              {
                name: "escrow",
                type: "address",
                internalType: "address",
              },
              {
                name: "organizationId",
                type: "bytes32",
                internalType: "bytes32",
              },
              {
                name: "refundRecipient",
                type: "address",
                internalType: "address",
              },
              {
                name: "sourceChainId",
                type: "uint256",
                internalType: "uint256",
              },
              {
                name: "sourceVault",
                type: "address",
                internalType: "address",
              },
              {
                name: "sourceBlockHash",
                type: "bytes32",
                internalType: "bytes32",
              },
              {
                name: "fixtureManifestRoot",
                type: "bytes32",
                internalType: "bytes32",
              },
              {
                name: "adapterId",
                type: "bytes32",
                internalType: "bytes32",
              },
              {
                name: "adapterCodeHash",
                type: "bytes32",
                internalType: "bytes32",
              },
              {
                name: "verifierConfigHash",
                type: "bytes32",
                internalType: "bytes32",
              },
              {
                name: "admissionSigner",
                type: "address",
                internalType: "address",
              },
              {
                name: "verdictSigner",
                type: "address",
                internalType: "address",
              },
              {
                name: "reportRecipientKeyId",
                type: "bytes32",
                internalType: "bytes32",
              },
              {
                name: "asset",
                type: "address",
                internalType: "address",
              },
              {
                name: "reward",
                type: "uint256",
                internalType: "uint256",
              },
              {
                name: "minimumDiscrepancy",
                type: "uint256",
                internalType: "uint256",
              },
              {
                name: "submissionDeadline",
                type: "uint64",
                internalType: "uint64",
              },
              {
                name: "settlementDeadline",
                type: "uint64",
                internalType: "uint64",
              },
              {
                name: "reservationDurationSeconds",
                type: "uint32",
                internalType: "uint32",
              },
              {
                name: "organizationNonce",
                type: "bytes32",
                internalType: "bytes32",
              },
            ],
          },
          {
            name: "reservation",
            type: "tuple",
            internalType: "struct BountyEscrow.Reservation",
            components: [
              {
                name: "claimId",
                type: "bytes32",
                internalType: "bytes32",
              },
              {
                name: "claimant",
                type: "address",
                internalType: "address",
              },
              {
                name: "evidenceCommitment",
                type: "bytes32",
                internalType: "bytes32",
              },
              {
                name: "reservedAt",
                type: "uint64",
                internalType: "uint64",
              },
              {
                name: "expiresAt",
                type: "uint64",
                internalType: "uint64",
              },
            ],
          },
          {
            name: "state",
            type: "uint8",
            internalType: "enum BountyEscrow.State",
          },
          {
            name: "unallocatedReward",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "claimantCredit",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "reportHash",
            type: "bytes32",
            internalType: "bytes32",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "policyHash",
    inputs: [
      {
        name: "policy",
        type: "tuple",
        internalType: "struct BountyEscrow.BountyPolicyV1",
        components: [
          {
            name: "settlementChainId",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "escrow",
            type: "address",
            internalType: "address",
          },
          {
            name: "organizationId",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "refundRecipient",
            type: "address",
            internalType: "address",
          },
          {
            name: "sourceChainId",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "sourceVault",
            type: "address",
            internalType: "address",
          },
          {
            name: "sourceBlockHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "fixtureManifestRoot",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "adapterId",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "adapterCodeHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "verifierConfigHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "admissionSigner",
            type: "address",
            internalType: "address",
          },
          {
            name: "verdictSigner",
            type: "address",
            internalType: "address",
          },
          {
            name: "reportRecipientKeyId",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "asset",
            type: "address",
            internalType: "address",
          },
          {
            name: "reward",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "minimumDiscrepancy",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "submissionDeadline",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "settlementDeadline",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "reservationDurationSeconds",
            type: "uint32",
            internalType: "uint32",
          },
          {
            name: "organizationNonce",
            type: "bytes32",
            internalType: "bytes32",
          },
        ],
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "pure",
  },
  {
    type: "function",
    name: "refundExpired",
    inputs: [
      {
        name: "id",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "reserveClaim",
    inputs: [
      {
        name: "admission",
        type: "tuple",
        internalType: "struct BountyEscrow.AdmissionV1",
        components: [
          {
            name: "bountyId",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "claimId",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "claimant",
            type: "address",
            internalType: "address",
          },
          {
            name: "evidenceCommitment",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "authorizationNonce",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "validUntil",
            type: "uint64",
            internalType: "uint64",
          },
        ],
      },
      {
        name: "signature",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "submitAssessment",
    inputs: [
      {
        name: "assessment",
        type: "tuple",
        internalType: "struct BountyEscrow.AssessmentV1",
        components: [
          {
            name: "bountyId",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "policyHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "claimId",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "claimant",
            type: "address",
            internalType: "address",
          },
          {
            name: "evidenceCommitment",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "caseNullifier",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "reportHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "adapterCodeHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "verifierConfigHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "outcome",
            type: "uint8",
            internalType: "uint8",
          },
          {
            name: "reward",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "assessedAt",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "validUntil",
            type: "uint64",
            internalType: "uint64",
          },
        ],
      },
      {
        name: "signature",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "totalLiability",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "usedAdmissionNonces",
    inputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "usedCaseNullifiers",
    inputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "usedClaimIds",
    inputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "BountyFunded",
    inputs: [
      {
        name: "bountyId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "organizationId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "reward",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "asset",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "policyHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "BountyRefunded",
    inputs: [
      {
        name: "bountyId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "refundRecipient",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "asset",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ClaimQualified",
    inputs: [
      {
        name: "bountyId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "claimId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "claimant",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "reward",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "reportHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ClaimRejected",
    inputs: [
      {
        name: "bountyId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "claimId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ClaimReserved",
    inputs: [
      {
        name: "bountyId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "claimId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "claimant",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "evidenceCommitment",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
      {
        name: "expiresAt",
        type: "uint64",
        indexed: false,
        internalType: "uint64",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "EIP712DomainChanged",
    inputs: [],
    anonymous: false,
  },
  {
    type: "event",
    name: "Paid",
    inputs: [
      {
        name: "bountyId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "claimId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "claimant",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "asset",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ReservationExpired",
    inputs: [
      {
        name: "bountyId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "claimId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "Duplicate",
    inputs: [],
  },
  {
    type: "error",
    name: "ECDSAInvalidSignature",
    inputs: [],
  },
  {
    type: "error",
    name: "ECDSAInvalidSignatureLength",
    inputs: [
      {
        name: "length",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "ECDSAInvalidSignatureS",
    inputs: [
      {
        name: "s",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
  },
  {
    type: "error",
    name: "Expired",
    inputs: [],
  },
  {
    type: "error",
    name: "FundingMismatch",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidAssessment",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidAuthorization",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidPolicy",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidShortString",
    inputs: [],
  },
  {
    type: "error",
    name: "NotExpired",
    inputs: [],
  },
  {
    type: "error",
    name: "ReentrancyGuardReentrantCall",
    inputs: [],
  },
  {
    type: "error",
    name: "SafeERC20FailedOperation",
    inputs: [
      {
        name: "token",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "StringTooLong",
    inputs: [
      {
        name: "str",
        type: "string",
        internalType: "string",
      },
    ],
  },
  {
    type: "error",
    name: "WrongState",
    inputs: [],
  },
] as const;
