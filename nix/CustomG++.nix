with import <nixpkgs> {};
writeShellApplication
{
  name = "CustomG++";
  text = builtins.readFile ./CustomG++.sh;
}
