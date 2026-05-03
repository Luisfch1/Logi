use strict; use warnings;
my $file = shift or die "file";
local $/;
open my $fh,'<',$file or die $!;
my $t = <$fh>; close $fh;

my $pattern = qr/0 0"btnBackupAllCreate"\)\.onclick = async \(\) => \{\n.*?\n\};/s;
my $replacement = join("\n",
  '$("btnBackupAllCreate").onclick = async () => {',
  '  try { await createBackupZipAll(); }',
  '  catch (err) {',
  '    console.error(err);',
  '    const msg = (err && (err.message || String(err))) ? (err.message || String(err)) : "Error desconocido";',
  '    alert("No pude crear el backup TOTAL.\\n\\nTip: cierra otras apps y reintenta.\\n\\nDetalle: " + msg);',
  '    $("backupAllStatus").textContent = "—";',
  '  }',
  '};'
);

if ($t !~ $pattern){
  die "Handler pattern not found\n";
}
$t =~ s/$pattern/$replacement/s;

open my $out,'>',$file or die $!;
print $out $t;
close $out;
