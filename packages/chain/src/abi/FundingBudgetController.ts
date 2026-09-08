export const fundingBudgetControllerAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "owner_",
        type: "address",
        internalType: "address",
      },
      {
        name: "operator_",
        type: "address",
        internalType: "address",
      },
      {
        name: "organizationId_",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "escrow_",
        type: "address",
        internalType: "contract BountyEscrow",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "approvals",
    inputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "reward",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "expiresAt",
        type: "uint64",
        internalType: "uint64",
      },
      {
        name: "consumed",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approvePolicy",
    inputs: [
      {
        name: "hash",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "reward",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "expiresAt",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
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
    name: "dailyLimit",
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
    name: "enabled",
    inputs: [],
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
    name: "escrow",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract BountyEscrow",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "fundApprovedPolicy",
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
    name: "lastAllocation",
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
    name: "minimumInterval",
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
    name: "operator",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "organizationId",
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
    name: "owner",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "perActionLimit",
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
    name: "setEnabled",
    inputs: [
      {
        name: "value",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setLimits",
    inputs: [
      {
        name: "perAction",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "daily",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "interval",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "spentPerDay",
    inputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
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
    name: "withdrawUnallocated",
    inputs: [
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "BudgetAllocated",
    inputs: [
      {
        name: "controller",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "policyHash",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "bountyId",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "utcDayBucket",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "BudgetSettingsChanged",
    inputs: [
      {
        name: "controller",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
      {
        name: "perActionLimit",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "dailyLimit",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "minimumInterval",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "BudgetWithdrawn",
    inputs: [
      {
        name: "controller",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "recipient",
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
    name: "PolicyApproved",
    inputs: [
      {
        name: "controller",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "policyHash",
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
        name: "expiresAt",
        type: "uint64",
        indexed: false,
        internalType: "uint64",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "BudgetLimitReached",
    inputs: [],
  },
  {
    type: "error",
    name: "Disabled",
    inputs: [],
  },
  {
    type: "error",
    name: "Forbidden",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidConfiguration",
    inputs: [],
  },
  {
    type: "error",
    name: "PolicyNotApproved",
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
] as const;
