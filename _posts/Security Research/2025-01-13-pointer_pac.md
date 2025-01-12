---
title: "We are [ARM]ed no more [ROP]pery Here"
classes: wide
header:
  teaser: /assets/images/pac.png
ribbon: red
description: "A blog on Pointer Authentication and How it mitigates ROP."
categories:
  - Exploit Development
tags:
  - Exploit Development
  - ROP
  - ROPGadget
  - Exploitation
  - zero day
  - 0day
  - cve
toc: true
---
# Introduction

In 2017, ARM introduced Pointer Authentication (PAC) as part of its ARMv8.3-A architecture updates. This groundbreaking solution aimed to tackle one of the most critical challenges in software security: memory corruption vulnerabilities. By leveraging cryptographic techniques, PAC made it significantly harder for attackers to tamper with pointers in memory undetected.

PAC plays a pivotal role in modern security by embedding Pointer Authentication Codes (PACs) into unused bits of pointer values. This innovative approach provides a lightweight and efficient mechanism for verifying pointer integrity while maintaining compatibility with existing systems. It addresses a variety of attack vectors, such as buffer overflows and control flow hijacking, which continue to pose threats in software development.

In this blog post, we will delve into the design and functionality of Pointer Authentication, exploring how it mitigates these security issues. We will also discuss its practical applications and the unique advantages it offers in environments that demand a balance between performance, size, and robust protection.

# The Problems

Memory corruption vulnerabilities represent a longstanding and critical challenge in software security. These vulnerabilities often stem from programming errors, such as buffer overflows, use-after-free conditions, or incorrect pointer handling, which allow attackers to manipulate memory content maliciously. Exploiting such vulnerabilities enables attackers to compromise the integrity of control data—such as function pointers, return addresses, or sensitive variables—leading to control flow hijacking, data manipulation, and unauthorized access.

A common form of memory corruption, buffer overflow, occurs when data written to a buffer exceeds its allocated size, overwriting adjacent memory locations. Similarly, use-after-free vulnerabilities exploit dangling pointers referencing deallocated memory, allowing attackers to read or write unintended memory regions. Heap corruption and integer overflow errors exacerbate these problems by disrupting memory allocators and enabling attackers to execute arbitrary code. These vulnerabilities often serve as entry points for exploitation techniques like return-oriented programming (ROP), privilege escalation, and remote code execution.

Existing defenses against memory corruption focus on three primary strategies: preventing corruption, detecting it, and obscuring targets. Prevention mechanisms include placing sensitive data and pointers in read-only memory. While effective for static data, this approach fails to protect dynamic pointers, such as return addresses on the stack or dynamically allocated objects. Detection mechanisms like Software Stack Protection (SSP) and Control Flow Integrity (CFI) verify pointer integrity before use, often relying on random values (e.g., stack canaries). However, these methods can be bypassed using memory disclosure vulnerabilities. Randomization techniques, such as Address Space Layout Randomization (ASLR), obscure the memory layout, making it harder for attackers to locate critical data. Yet, these defenses are insufficient against sophisticated exploits that bypass randomization using memory leaks or brute force.

The impact of memory corruption vulnerabilities is severe, ranging from system crashes and denial of service to full system compromise through privilege escalation or remote code execution. Despite advancements in defensive techniques, their effectiveness is often hindered by performance trade-offs, implementation complexity, and compatibility issues, especially in resource-constrained environments. These limitations underscore the need for a robust, lightweight, and efficient solution. **Pointer Authentication (PAC)** addresses these challenges by embedding cryptographically secure authentication codes into pointers, providing a powerful mechanism to detect and prevent memory corruption with minimal performance overhead.
# Understanding ROP Exploitation

Return-Oriented Programming (ROP) is a sophisticated exploitation technique designed to bypass modern memory protection mechanisms such as Data Execution Prevention (DEP). DEP prevents the execution of code from writable memory regions, effectively stopping traditional code injection attacks. However, ROP circumvents this by reusing legitimate code sequences, known as "gadgets," already present in the program's executable memory.

A gadget is a short sequence of instructions that typically ends with a `RET` (return) instruction. These gadgets are scattered throughout the memory of an executable or its linked libraries, such as libc. By chaining these gadgets, attackers can perform arbitrary computations without injecting new code. For example, a gadget might consist of two instructions like `POP RDI; RET`, which pops a value into the `RDI` register (used for the first argument in many calling conventions) and then returns control to the next address on the stack.

The history of ROP can be traced back to earlier exploitation techniques such as "return-to-libc," where attackers hijacked control flow to call functions like `system()` directly. ROP extends this concept by enabling attackers to construct complex payloads, using gadgets to perform operations such as arithmetic, memory writes, or system calls, all while evading DEP.

## Relation to Memory Corruption Vulnerabilities

Memory corruption vulnerabilities are the foundational enablers of ROP attacks. Common vulnerabilities like buffer overflows, use-after-free bugs, or heap corruption allow attackers to manipulate the program's memory, specifically the stack or heap, to set up ROP chains.

For example, in a stack-based buffer overflow, the attacker writes beyond the buffer's boundary and overwrites the return address of a function. By replacing this return address with the address of a gadget, the attacker can redirect control flow to that gadget. Subsequent gadgets are then executed in sequence, as each `RET` instruction directs execution to the next address on the manipulated stack.

Consider the following simple vulnerable C code:

```c
void vulnerable_function(char *input) {
    char buffer[64];
    strcpy(buffer, input); // No bounds checking!
}
```

An attacker exploiting this vulnerability can provide input that overwrites the `buffer` and the return address on the stack. Instead of returning to the normal execution flow, the program will execute a ROP chain, starting with a gadget like `POP RDI; RET`. The attacker can then supply the address of `/bin/sh` to the `RDI` register, followed by gadgets to call `system()`.

Memory corruption is essential to ROP because it enables the attacker to gain control over the execution flow. Without the ability to overwrite return addresses or function pointers, ROP chains cannot be executed. This dependency also makes defenses like stack canaries or shadow stacks relevant, as they attempt to detect or prevent unauthorized changes to the stack.

## How it works ?
Unlike traditional exploits that inject malicious code, ROP uses snippets of legitimate instructions already present in the program's memory or linked libraries. This makes ROP effective at bypassing defenses like Data Execution Prevention (DEP), which prevents execution from writable memory regions. Below, we dive into the details of how ROP works with technical explanations, memory examples, and lifecycle.

Let's take the following program as an example, The program starts executing, and user input is passed to a vulnerable function. If the input size exceeds the allocated buffer's limit (`buffer[64]`), it causes a **buffer overflow**, enabling the attacker to overwrite the stack.

- Stack Layout Before Overflow:
```
+---------------------+
| Local variables     | (e.g., buffer[64])
+---------------------+
| Saved EBP           | (Base pointer)
+---------------------+
| Return Address      | (Points to code after vulnerable_function)
+---------------------+
```


### Stage 1: Overwriting the Return Address

The attacker’s crafted input overwrites the return address on the stack. This input includes:
1. **Padding** to fill the buffer (64 bytes).
2. **Overwritten EBP** (optional).
3. **Address of the first gadget**, such as `POP RDI; POP RSI; RET`.

So, The input would be as the following:
```
'A' * 64 + 'B' * 8 + Address of Gadget + Arguments for target_function
```

After passing the input, The stack would be as the following:

- Stack Layout After Overflow:
```
+--------------------------+
| Padding ('A' * 64)       |
+--------------------------+
| Overwritten EBP ('B' * 8)|
+--------------------------+
| Gadget Address (0x400123)| --> POP RDI; POP RSI; RET
+--------------------------+
```

### Stage 2: Executing the First Gadget


![image](https://github.com/user-attachments/assets/943fe131-594d-4e52-93d2-4628f1eb7823)



The processor reaches the overwritten return address and executes the first `ROP` gadget. The gadget (`POP RDI; POP RSI; RET`) pops two values from the stack into the `RDI` and `RSI` registers, setting up the arguments for the target function. Which making the Stack Layout as the following:

- Stack Layout After Gadget Execution:
```
+--------------------------+
| Argument 1 (5)           | --> RDI
+--------------------------+
| Argument 2 (10)          | --> RSI
+--------------------------+
| target_function Address  | --> 0x400456
+--------------------------+
```


### Stage 3: Redirecting to the Target Function

The next address on the stack directs the program to execute the `target_function` with the attacker-controlled arguments. The function performs its operation (`a + b`) and returns the result.

1. The `RET` instruction redirects control flow to `target_function`.
2. The arguments (`5` and `10`) are passed to `target_function` via the `RDI` and `RSI` registers.
3. `target_function(5, 10)` calculates `5 + 10` and returns `15`.

 After the ROP chain, the stack would look like this:
```
+--------------------------+
| Padding ('A' * 64)       |
+--------------------------+
| Overwritten EBP ('B' * 8)|
+--------------------------+
| Gadget Address (0x400123)| --> POP RDI; POP RSI; RET
+--------------------------+
| Argument 1 (5)           | --> RDI
+--------------------------+
| Argument 2 (10)          | --> RSI
+--------------------------+
| target_function Address  | --> 0x400456
+--------------------------+
```


# Pointers and Their Role in Exploitation

Pointers are variables that store the memory address of another variable. Instead of holding a direct value, pointers reference a specific location in memory, enabling programs to directly access or modify the data stored there. In low-level programming languages like C and C++, pointers are critical for efficient memory management, dynamic allocation, and implementing advanced data structures like linked lists, trees, and graphs. However, their direct interaction with memory also makes them prone to misuse and exploitation.

```c
int x = 42;      // Variable x holds the value 42
int *ptr = &x;   // Pointer ptr stores the address of x
```

- `x` stores the value `42`.
- `ptr` stores the memory address of `x`. Dereferencing `ptr` using `*ptr` gives access to the value stored at the address, allowing `42` to be read or modified.

- Memory Layout
```
Memory Address   Value       Description
0x7ffeec38       42          x's value
0x7ffeec34       0x7ffeec38  ptr points to x's address
```

### **How Do Pointers Work?**

Pointers interact with memory directly, enabling operations like accessing data, modifying values, and navigating memory regions. They are a critical component in managing program execution flow and dynamic memory allocation.

1. **Memory Address Representation**:
   - A pointer stores the numeric address of a variable in memory. In a 64-bit architecture, pointers typically occupy 8 bytes, allowing them to address large memory spaces.

2. **Dereferencing**:
   - Dereferencing a pointer retrieves the value stored at the memory location it references. For example:
     ```c
     int *ptr = &x;
     printf("%d\n", *ptr);  // Outputs the value of x (42)
     ```

3. **Pointer Arithmetic**:
   - Pointers can perform arithmetic operations to navigate memory. For instance, in an array:
     ```c
     int arr[3] = {10, 20, 30};
     int *ptr = arr;
     printf("%d\n", *(ptr + 1));  // Outputs 20
     ```

4. **Function Pointers**:
   - Pointers can store the address of functions, allowing dynamic invocation:
     ```c
     void (*func_ptr)(int) = &some_function;
     func_ptr(5);  // Calls some_function with argument 5
     ```

## **Relation Between Pointers and ROP**

Pointers play a foundational role in Return-Oriented Programming (ROP) by controlling memory access and program execution flow. In ROP, attackers manipulate pointers such as return addresses or function pointers to hijack control flow and execute malicious payloads.

Control flow in programs relies on pointers, especially return address pointers stored on the stack during function calls. These pointers determine the program's next execution location after a function returns.

- **Example**:
```c
void func() {
    printf("Hello, World!\n");
}
int main() {
    func();
    return 0;
}
```

**Normal Control Flow**:
1. Before `func()` executes, the return address (RA) is pushed onto the stack.
2. After `func()` completes, the CPU retrieves the RA pointer from the stack and resumes execution in `main()`.

##### **Memory Drawing: Return Address in Normal Execution**
```
Stack (Before func() returns)
+--------------------------+
| Return Address (0x400456)| --> Points to code in main()
+--------------------------+
```

In a ROP attack, this return address pointer is overwritten to redirect execution to a ROP gadget. As ROP exploits use "gadgets"—small sequences of instructions ending in `RET`. Each gadget’s address is stored as a pointer in the attack payload. The CPU reads these pointers during execution to chain together gadgets and execute the attacker’s payload.


# Pointer Authentication (PAC)

Pointer Authentication (PAC) is a security mechanism introduced in the ARMv8.3-A architecture to strengthen memory safety by embedding cryptographic signatures—called **Pointer Authentication Codes (PACs)**—into unused bits of pointers. The goal of PAC is to prevent memory corruption exploits such as Return-Oriented Programming (ROP) and Jump-Oriented Programming (JOP), which attempt to hijack control flow by overwriting pointers like return addresses and function pointers.

PAC binds pointers to a specific execution context (such as the stack pointer) using a cryptographic signature generated from the pointer's value, the context, and a secret key. Any modification to the pointer (even a single bit) results in an invalid PAC, causing the pointer authentication to fail and triggering a program exception.

##### **Purpose of PAC**
- **Return Address Protection**: Protects return addresses from being overwritten by attackers.
- **Function Pointer Integrity**: Ensures that function pointers are not maliciously redirected.
- **Data Pointer Verification**: Prevents unauthorized memory access by validating data pointers.

## **How PAC Works**

PAC works in three key stages:
1. **Embedding Cryptographic Signatures in Unused Pointer Bits**
2. **Using PAC for Verification Before Dereferencing Pointers**
3. **Stripping PAC for Raw Pointer Usage**

### **1. Embedding Cryptographic Signatures in Unused Pointer Bits**

PAC embeds cryptographic signatures in unused high-order bits of the pointer without affecting its actual value.

![image](https://github.com/user-attachments/assets/1d0f6743-44aa-48d3-a28b-a1445715bddc)



##### **Step 1: Gathering Inputs for PAC Generation**

To generate a PAC, the system gathers three essential inputs:
1. **Pointer Value**: The raw memory address (e.g., `0x7ffeec38`).
2. **Context**: Additional information that contextualizes the pointer, such as the stack pointer (`sp`) or function arguments.
3. **Secret Key**: A per-process unique key stored in system registers (`APIAKey`, `APIBKey`, `APDAKey`, `APDBKey`, etc.).

The combination of these inputs ensures that the PAC is unique for each pointer and context.

##### **Step 2: Cryptographic Signing with QARMA**

The **QARMA cryptographic algorithm** processes the inputs to generate a PAC. QARMA is a lightweight block cipher designed for efficiency and high security. The algorithm takes the following steps:
- **Rounds of Transformation**: QARMA performs multiple rounds of transformations on the input data, mixing the key, context, and pointer value.
- **Tweakable Cipher**: QARMA uses a "tweak" (context) to modify the encryption process, ensuring unique PACs for different contexts.

##### **Step 3: Embedding the PAC into the Pointer**

The PAC is embedded into the unused high-order bits of the pointer. On ARM64 systems with a 48-bit virtual address space, the top 16 bits of the pointer can be used for PAC storage:
```
+--------------------------+----------------+
| Pointer Value (48 bits)  | PAC (16 bits)  |
+--------------------------+----------------+
```

##### **Example**:
- Raw pointer: `0x7ffeec38`
- Generated PAC: `0x1234`
- Signed pointer: `0x12347ffeec38`

The signed pointer (`0x12347ffeec38`) looks like a normal memory address but contains an embedded authentication code in the high-order bits.


### **2. Using PAC for Verification Before Dereferencing Pointers**

PAC verification ensures that the pointer has not been modified before it is used. This prevents attackers from overwriting pointers with malicious values.
![image](https://github.com/user-attachments/assets/7b7f4b2c-d7ce-42c8-bb79-22798a3ea71b)


##### **Step 1: Extracting the PAC and Pointer**

When the pointer is accessed, the system extracts the high-order bits (the PAC) and the lower bits (the pointer value) separately:
- **Pointer Value**: The base memory address (e.g., `0x7ffeec38`).
- **Embedded PAC**: The authentication code (e.g., `0x1234`).

##### **Step 2: Recomputing the PAC**

The system uses the same inputs (pointer value, context, and secret key) to recompute the PAC using the `QARMA` algorithm. This step ensures that the verification process matches the original PAC generation.

##### **Step 3: Comparing the PACs**

The recomputed PAC is compared to the embedded PAC:
- **If the PACs match**: The pointer is valid, and the program proceeds to dereference it.
- **If the PACs do not match**: The program halts, triggering an exception to prevent further execution.

### **3. Stripping PAC for Pointer Arithmetic**

Certain operations, such as pointer arithmetic, require the raw pointer value. In such cases, the PAC must be stripped from the pointer without validation. This is done using the `XPACI` (eXecute PAC stripping) instruction.

##### **Process:**
1. The CPU removes the PAC from the pointer’s high-order bits.
2. The raw pointer value is used for calculations.
3. The pointer may be re-signed after the calculation if it will be dereferenced.

##### **Example:**
- Signed Pointer: `0x12347ffeec38`
- After `XPACI`: `0x7ffeec38`
      
## PAC Instructions and Assembly
Pointer Authentication (PAC) uses specialized ARMv8.3-A assembly instructions to generate, verify, and manipulate pointer authentication codes. These instructions form the building blocks of PAC and are essential for securing instruction addresses, function pointers, and data pointers.

### **1. `PACIA` (Pointer Authentication Code for Instruction Address)**

`PACIA` is used to sign an **instruction pointer** (e.g., a return address) with a **Pointer Authentication Code (PAC)**. The PAC is embedded into the unused high-order bits of the pointer, binding the pointer to a specific execution context. The instruction uses a secret key (`APIAKey`) stored in system registers and a context value (usually the stack pointer) to generate a unique PAC for each return address.

**Assembly Syntax**:
```assembly
PACIA xN, xM  // Sign the instruction pointer in xN using the context in xM
```

- **Target register (`xN`)**: Holds the pointer (e.g., `x30` for the link register).
- **Context register (`xM`)**: Holds the context (e.g., `sp` for the stack pointer).

**Example**:
```assembly
PACIA x30, sp  // Signs the return address (stored in x30) using the stack pointer (sp)
```

In this example, the return address is signed with a PAC before being saved to the stack. This ensures that the return address cannot be modified without invalidating the PAC. The PAC is generated based on:
- The value of `x30` (the return address).
- The value of `sp` (the stack pointer).
- The `APIAKey` (a secret key stored in the CPU register).

The signed return address now contains the PAC in its upper bits:
```
+--------------------------+----------------+
| Return Address (48 bits) | PAC (16 bits)  |
+--------------------------+----------------+
```

The attacker would need the exact key and context to generate a valid PAC, making it infeasible to forge or manipulate the signed pointer.

### **2. `AUTIA` (Authenticate Instruction Address)**

`AUTIA` is used to verify a signed **instruction pointer**. It recomputes the PAC for the pointer using the same key and context and compares it with the embedded PAC. If the PACs match, the pointer is valid and restored to its original value. If they do not match, an exception is triggered, preventing the execution of malicious instructions.

**Assembly Syntax**:
```assembly
AUTIA xN, xM  // Authenticate the signed instruction pointer in xN using the context in xM
```

- **Target register (`xN`)**: Holds the signed pointer (e.g., `x30` for the link register).
- **Context register (`xM`)**: Holds the context used during PAC generation (e.g., `sp`).


**Example**:
```assembly
AUTIA x30, sp  // Verifies the PAC in the return address using the stack pointer
```

In this example:
- The CPU recomputes the PAC for `x30` using the same key and context (`sp`).
- If the computed PAC matches the embedded PAC, the original return address is restored.
- If there is any mismatch (indicating tampering), an **exception** is raised, halting program execution.

### **3. `XPACI` (Strip PAC for Instruction Address)**

`XPACI` is used to **remove the PAC** from a signed **instruction pointer** without verification. This is necessary when the raw address value is needed for operations such as pointer arithmetic.

**Assembly Syntax**:
```assembly
XPACI xN  // Strip the PAC from the instruction pointer in xN
```

- **Target register (`xN`)**: Holds the signed pointer (e.g., `x30`).

**Example**:
```assembly
XPACI x30  // Removes the PAC from the return address in x30
```

In this example:
- The upper 16 bits (containing the PAC) are cleared, leaving only the original 48-bit pointer value.
- This instruction is often used before performing arithmetic or storing the pointer in a structure that does not support PAC.

### **4. `RETA` (Return with Authentication)**

`RETA` combines PAC verification and return in a single instruction. It verifies the signed **return address** (`x30`) and transfers control to the original caller if the verification succeeds.
**Assembly Syntax**:
```assembly
RETA  // Authenticate and return to the caller
```

- **Register (`x30`)**: Holds the signed return address.

**Example**:
```assembly
RETA  // Verifies the return address and returns to the caller
```

- If the PAC verification fails, an exception is triggered, halting the program.
- If successful, control is returned to the original caller.


### ** End-to-End PAC Workflow**


As example of how PAC is used to secure a function’s return address.

```assembly
// Function prologue: Save signed return address to stack
PACIA x30, sp        // Sign the return address (x30) with the stack pointer (sp)
stp x29, x30, [sp]   // Save frame pointer (x29) and signed return address (x30) on the stack

// Function body
MOV x0, #10          // Example computation: Load value 10 into register x0
ADD x0, x0, #20      // Add 20 to x0 (result: 30)

// Function epilogue: Restore and verify return address
ldp x29, x30, [sp]   // Restore frame pointer (x29) and signed return address (x30)
AUTIA x30, sp        // Authenticate return address using the stack pointer
RET                  // Return to the caller if authentication succeeds
```



![image](https://github.com/user-attachments/assets/349d6f5f-a0fd-4768-b8c2-a3d8c30005da)



1. **Prologue: Signing the Return Address**
   - `PACIA x30, sp`: Generates a PAC for the return address (`x30`) using the stack pointer (`sp`) as context. The PAC is embedded in the high-order bits of the return address.
   - `stp x29, x30, [sp]`: Saves the signed return address and the frame pointer (`x29`) to the stack.

2. **Function Body: Main Execution**
   - The function performs computations as needed (e.g., loading and adding values).

3. **Epilogue: Verifying and Returning**
   - `ldp x29, x30, [sp]`: Restores the frame pointer and signed return address.
   - `AUTIA x30, sp`: Verifies the PAC in the return address using the same context (`sp`). If the PAC is valid, the original address is restored; otherwise, an exception is raised.
   - `RET`: Transfers control back to the caller if verification succeeds.

### **Stack Protection with PAC**

In real-world systems, PAC is commonly used to protect the **return address** on the stack to prevent control flow hijacking.

```c
void vulnerable_function(char *input) {
    char buffer[64];
    strcpy(buffer, input);  // Vulnerable to buffer overflow
}
```

- The `strcpy` function copies `input` into `buffer[]` without bounds checking.
- If `input` is longer than 64 bytes, it can overwrite the return address on the stack.
- An attacker can exploit this to redirect control flow to a malicious ROP chain.

By enabling PAC, the return address is signed and verified:
```assembly
PACIA x30, sp        // Sign the return address using the stack pointer
stp x29, x30, [sp]   // Save frame pointer and signed return address
ldp x29, x30, [sp]   // Restore frame pointer and signed return address
AUTIA x30, sp        // Authenticate the return address
RET                  // Return if PAC verification succeeds
```

- **PACIA** signs the return address.
- **AUTIA** verifies the PAC before returning.
- If the PAC does not match, the program halts, preventing the attacker from redirecting control flow.


## How PAC Prevents ROP

Let’s walk through the stages where PAC secures a function’s return address:


#### **1. Signing the Return Address**

During the **function prologue**, the return address stored in the **link register (`x30`)** is signed with a PAC before being saved to the stack.

**Assembly Example:**
```assembly
PACIA x30, sp        // Sign the return address (x30) using the stack pointer (sp) as context
stp x29, x30, [sp]   // Save frame pointer (x29) and signed return address (x30) to the stack
```

- **`PACIA` (Pointer Authentication Code for Instruction Address)**: Generates a PAC for the return address using:
  - **Return address (`x30`)**: The actual instruction address where the function should return.
  - **Context (`sp`)**: The stack pointer, making the PAC context-specific.
  - **Key (`APIAKey`)**: A secret key stored in the CPU register.

The signed return address is then stored on the stack.

**Memory Layout:**
```
+--------------------------+
| Signed Return Address    | --> Contains the original address and PAC
+--------------------------+
| Frame Pointer            |
+--------------------------+
```

#### **2. Verifying the Return Address**

During the **function epilogue**, the return address is restored from the stack and authenticated before the function returns.

```assembly
ldp x29, x30, [sp]   // Restore frame pointer (x29) and signed return address (x30)
AUTIA x30, sp        // Authenticate the return address using the stack pointer
RET                  // Return to the caller if PAC verification succeeds
```

**`AUTIA` (Authenticate Instruction Address)**: Verifies the PAC embedded in the return address.
 - Recomputes the PAC using the same inputs (return address, stack pointer, and key).
  - Compares the recomputed PAC with the embedded PAC.
  - If they match, the return address is valid, and the program continues execution.
  - If they do not match, an **exception** is triggered, halting the program.

### **PAC Process in ROP Mitigation**


![image](https://github.com/user-attachments/assets/ac6b71b1-cadd-4d28-9331-f40190d7f34e)



1. **Function Call (Signing Stage)**:
   - The CPU saves the signed return address to the stack.
   - The signed pointer looks like a regular memory address but includes a cryptographic signature in the high-order bits.

2. **Function Return (Verification Stage)**:
   - The CPU loads the signed return address from the stack.
   - The PAC is validated against the context and the secret key.
   - If the validation fails, the CPU raises an exception.



## Limitations and Potential Bypass Techniques

Despite its robust design, Pointer Authentication (PAC) has certain limitations that sophisticated attackers can potentially exploit. These limitations revolve around the inherent challenges of cryptographic systems and the implementation choices made for performance and compatibility. Below is a detailed analysis of known bypass methods, challenges, and the real-world feasibility of these attacks.

### **1. Brute-Forcing PAC Values with Small PAC Sizes**

One of the primary limitations of PAC is the size of the **Pointer Authentication Code (PAC)**. Depending on the system configuration, the PAC may be as small as **7 to 16 bits**. A small PAC size implies that there are relatively few possible PAC values, making brute-forcing theoretically possible.

1. The attacker modifies the pointer and guesses different PAC values.
2. They repeatedly try to execute the program with different PACs until a valid PAC is found.
3. With a small PAC size (e.g., 7 bits), there are `2^7 = 128` possible values, which may seem trivial to brute-force.

### **2. Pointer Substitution Attacks**

In a pointer substitution attack, the attacker **replaces a valid PAC-protected pointer** with another **valid PAC-protected pointer** from the same or different context. Since the substituted pointer already has a valid PAC, it may pass verification.

1. The attacker finds a valid signed pointer in memory (e.g., a signed return address).
2. They replace a different pointer (e.g., a function pointer) with this valid pointer.
3. The program dereferences the substituted pointer, potentially leading to unintended behavior.

Imagine a program where two functions have PAC-protected return addresses:
- `func_A`: Signed return address `0x12347ffeec38`.
- `func_B`: Signed return address `0x56787fffabc0`.

# **Challenges**
Memory disclosure vulnerabilities allow attackers to **leak sensitive data** from memory, including PAC-protected pointers and PAC keys. If an attacker can leak:
- A valid PAC-protected pointer and its context, they can potentially reuse the pointer for exploitation.
- The PAC keys stored in hardware registers, they can generate valid PACs, bypassing the protection entirely.


# Conclusion
Pointer Authentication (PAC) is a powerful and efficient hardware-based defense mechanism designed to enhance control flow integrity and mitigate memory corruption attacks, such as Return-Oriented Programming (ROP) and Jump-Oriented Programming (JOP). By embedding cryptographic signatures (Pointer Authentication Codes) directly into pointers and verifying them before use, PAC provides robust protection for return addresses, function pointers, and other sensitive data. Throughout this blog post, we have explored the fundamental components of PAC, including its cryptographic foundation (QARMA algorithm), key instructions (`PACIA`, `AUTIA`, `XPAC`, `RETA`), and real-world implementations for stack and function pointer protection. PAC strengthens system security by binding pointers to their specific context (e.g., the stack pointer or program counter), making it infeasible for attackers to forge or manipulate pointers without triggering an exception.
However, PAC is not without its limitations. Brute-forcing PAC values becomes theoretically possible when small PAC sizes (e.g., 7 bits) are used, although practical exploitation is limited by hardware constraints and frequent program crashes. Additionally, pointer substitution attacks and memory disclosure vulnerabilities remain challenges that require additional layers of defense, such as Address Space Layout Randomization (ASLR), secure key management, and frequent re-randomization of PAC keys. 

In summary, PAC represents a significant advancement in memory safety and control flow protection. When combined with other security mechanisms, such as ASLR and stack canaries, PAC can effectively mitigate a wide range of memory corruption exploits. Despite its limitations, PAC sets a high bar for attackers, making exploitation significantly more difficult and costly. As hardware security continues to evolve, further improvements to PAC and its integration with software defenses will help fortify modern systems against sophisticated threats.


# References
- https://eprint.iacr.org/2016/444.pdf
- https://www.qualcomm.com/content/dam/qcomm-martech/dm-assets/documents/pointer-auth-v7.pdf
- https://developer.arm.com/documentation/109576/0100/Introduction
- https://www.youtube.com/watch?v=UD1KKHyPnZ4
- https://www.youtube.com/watch?v=feU3H5u8hig
- https://www.youtube.com/watch?v=yzvHzfp2APc
