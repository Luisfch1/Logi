use strict;
use warnings;
local $/;
my $file = shift @ARGV;
open my $fh, '<', $file or die $!;
my $s = <$fh>;
close $fh;

# Remove extra stray closing after itemsInput.onchange
$s =~ s/\n\};\n\};\n\n\n\/\* ===========================\n   IndexedDB/\n};\n\n\n\/* ===========================\n   IndexedDB/s;

# Replace downloadTemplateItems (and remove stray extra brace right after)
my $new_func = <<'JS';
function downloadTemplateItems(){
  try{
    const wb = XLSX.utils.book_new();
    const data = [["ITEM","DESCRIPCION"],["",""]];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 18 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, ws, "ITEMS");
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Logi2_Plantilla_Items.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1500);
  }catch(e){
    console.error(e);
    alert("No pude generar la plantilla. Intenta nuevamente.");
  }
}
JS

$s =~ s/function downloadTemplateItems\(\)\{[\s\S]*?\n\}\n\}/$new_func/s;

# Close dbClear() (it was missing the final closing brace)
$s =~ s/tx\.onerror = \(\) => reject\(tx\.error\);\n  \}\);\n\n\/\* ===========================\n   Catálogo de ítems \(por proyecto\)\n/tx.onerror = () => reject(tx.error);\n  });\n}\n\n\/* ===========================\n   Catálogo de ítems (por proyecto)\n/s;

open my $out, '>', $file or die $!;
print {$out} $s;
close $out;
